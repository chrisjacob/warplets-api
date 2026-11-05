"""Replay test vectors against the captured Meteora ELF in an in-process SVM.

All test keypairs derive from fixed public fixture seeds. No RPC, CLI wallet,
key file, remote endpoint or network is used here.
"""
from base64 import b64decode
import gzip
import hashlib
import json
from pathlib import Path

from solders.account import Account
from solders.clock import Clock
from solders.compute_budget import set_compute_unit_limit
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.litesvm import LiteSVM
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solders.transaction_metadata import FailedTransactionMetadata

FIXTURES = Path(__file__).parent / "fixtures"
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
key = Pubkey.from_string
digest = lambda data: hashlib.sha256(data).hexdigest()


def program_bytes():
    compressed = (FIXTURES / "programs-mainnet.json.gz").read_bytes()
    assert digest(compressed) == "4159978c9699c5ae450fff95a2c1b022ab04d38a49b2c5b4675f3dfbfa9c6296"
    capture = json.loads(gzip.decompress(compressed))
    expected = json.loads((FIXTURES / "programs.json").read_bytes())["programs"][0]
    accounts = {record["address"]: record for record in capture["accounts"]}
    program = accounts[expected["address"]]
    data = b64decode(accounts[program["programData"]]["data"], validate=True)
    assert digest(data[45:]) == "967ff9fb161eec2e62f66d2c899100739fb747c445f697b8625c86b31b9a2022"
    return key(expected["address"]), data[45:]


def sdk_instructions(rows):
    return [Instruction(key(row["program"]), bytes.fromhex(row["data"]),
                        [AccountMeta(key(a["key"]), a["signer"], a["writable"]) for a in row["accounts"]])
            for row in rows]


def uint(data, offset, size=8):
    return int.from_bytes(data[offset:offset + size], "little")


def install_mint(vm, address, supply):
    data = bytearray(82)
    data[36:44] = supply.to_bytes(8, "little")
    data[44:46] = bytes([9, 1])
    vm.set_account(address, Account(10_000_000, bytes(data), TOKEN))


def install_balance(vm, address, mint, owner, units):
    data = bytearray(165)
    data[:32], data[32:64] = bytes(mint), bytes(owner)
    data[64:72] = units.to_bytes(8, "little")
    data[108] = 1
    vm.set_account(address, Account(10_000_000, bytes(data), TOKEN))


def run():
    vector = json.loads((FIXTURES / "damm-v2-prd-vector.json").read_bytes())
    program, elf = program_bytes()
    assert str(program) == vector["program"]
    vm = LiteSVM()
    vm.add_program(program, elf)
    payer = Keypair.from_seed(bytes([4]) * 32)
    position_mint = Keypair.from_seed(bytes([5]) * 32)
    assert str(payer.pubkey()) == vector["payer"]
    assert str(position_mint.pubkey()) == vector["nft"]
    vm.airdrop(payer.pubkey(), 10_000_000_000)
    now = vector["activation"]
    def clock(at):
        vm.set_clock(Clock(100 + at - now, now - 1000, 0, 0, at))
    clock(now - 60)
    def send(instructions, extra=(), expected_failure=False):
        # The blockhash changes for each transaction, even at the same clock.
        vm.expire_blockhash()
        tx = Transaction.new_signed_with_payer(
            [set_compute_unit_limit(1_400_000), *instructions], payer.pubkey(),
            [payer, *extra], vm.latest_blockhash())
        result = vm.send_transaction(tx)
        if isinstance(result, FailedTransactionMetadata):
            if expected_failure:
                return result
            raise AssertionError(f"execution failed: {result.err()} {result.meta().logs()}")
        assert not expected_failure, "transaction unexpectedly succeeded"
        return result

    mint, og, att_ata, og_ata = [key(vector[name]) for name in ("mint", "og", "attAta", "ogAta")]
    lp = int(vector["allocation"]["liquidity"])
    supply = int(vector["supply"])
    install_mint(vm, mint, supply)
    install_mint(vm, og, 1_000_000_001)
    install_balance(vm, att_ata, mint, payer.pubkey(), lp)
    reserves = {}
    for seed, bucket in enumerate(("earn", "stake", "genesisVault", "seasonVault"), 20):
        account = Keypair.from_seed(bytes([seed]) * 32).pubkey()
        units = int(vector["allocation"][bucket])
        reserves[account] = units
        install_balance(vm, account, mint, payer.pubkey(), units)
    assert lp + sum(reserves.values()) == supply
    install_balance(vm, og_ata, og, payer.pubkey(), 0)
    spare = Keypair.from_seed(bytes([6]) * 32).pubkey()
    install_balance(vm, spare, og, payer.pubkey(), 1_000_000_001)
    def transfer_og(units):
        accounts = [AccountMeta(spare, False, True), AccountMeta(og_ata, False, True),
                    AccountMeta(payer.pubkey(), True, False)]
        send([Instruction(TOKEN, b"\x03" + units.to_bytes(8, "little"), accounts)])
    def balance(address):
        return uint(vm.get_account(address).data, 64)

    pool, position = key(vector["pool"]), key(vector["position"])
    init = sdk_instructions(vector["initAndLock"])
    failure = send(init, (position_mint,), expected_failure=True)
    assert any("insufficient" in log.lower() for log in failure.meta().logs()), failure.meta().logs()
    assert vm.get_account(pool) is None
    transfer_og(1)
    send(init, (position_mint,))
    assert vm.get_account(pool).owner == program
    state = vm.get_account(pool).data
    # Pinned Pool account layout: discriminator, PoolFeesStruct (160), mints.
    assert state[168:200] == bytes(mint) and state[200:232] == bytes(og)
    assert state[232:264] == bytes(key(vector["tokenAVault"])) and state[264:296] == bytes(key(vector["tokenBVault"]))
    assert balance(key(vector["tokenAVault"])) == lp and balance(att_ata) == 0
    assert balance(key(vector["tokenBVault"])) == 1 and balance(og_ata) == 0
    # Pinned Position layout: two pubkeys, two 32-byte checkpoints,
    # two u64 pending fees, then unlocked, vested and permanently locked u128.
    pdata = vm.get_account(position).data
    assert vm.get_account(position).owner == program and pdata[8:40] == bytes(pool)
    assert uint(pdata, 152, 16) == 0 and uint(pdata, 184, 16) == int(vector["delta"])
    # Pool baseFeeInfo converts the Borsh 27-byte schedule into a 32-byte
    # aligned structure. Compare actual initialized state after program execution.
    assert uint(state, 8) == 900_000_000 and state[16] == 0
    assert uint(state, 22, 2) == 89 and uint(state, 24) == 1 and uint(state, 32) == 10_000_000
    transfer_og(1_000_000_000)
    buy, sell = sdk_instructions(vector["buy"]), sdk_instructions(vector["sell"])
    send(buy, expected_failure=True)
    samples = []
    for elapsed in (0, 1, 30, 60, 88, 89, 90):
        clock(now + elapsed)
        att_before, og_before = balance(att_ata), balance(og_ata)
        before = vm.get_account(pool).data
        send(buy)
        after = vm.get_account(pool).data
        assert balance(att_ata) > att_before and og_before - balance(og_ata) == 1_000_000
        retained_pct = after[48]  # PoolFeesStruct.protocol_fee_percent
        fee = 1_000_000 * max(1, 90 - elapsed) // 100
        delta = uint(after, 400) - uint(before, 400)
        assert retained_pct > 0 and delta == fee * retained_pct // 100, (elapsed, delta, fee, retained_pct)
        assert uint(after, 392) == uint(before, 392)  # OnlyB: no ATT protocol fee.
        samples.append({"second": elapsed, "ogProtocolFeeRaw": delta})
    before_a, before_b = balance(att_ata), balance(og_ata)
    send(sell)
    assert before_a - balance(att_ata) == 1_000_000 and balance(og_ata) > before_b
    for account, amount in reserves.items():
        assert balance(account) == amount
    print(json.dumps({"fixtureSlot": 463107036, "lpBaseUnits": lp, "ogSeedRaw": 1,
                      "protocolFeePercent": retained_pct, "buySamples": samples,
                      "sellExecuted": True, "liveParity": "unverified", "kamino": "not captured"}))


if __name__ == "__main__":
    run()
