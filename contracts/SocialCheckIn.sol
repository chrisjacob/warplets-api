// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A no-payment daily presence record for 10X Social on Base mainnet.
contract SocialCheckIn {
    mapping(address => uint256) public lastDay;
    event CheckedIn(address indexed member, uint256 indexed day);
    error AlreadyCheckedIn();

    function checkIn() external {
        uint256 day = block.timestamp / 1 days;
        if (lastDay[msg.sender] == day) revert AlreadyCheckedIn();
        lastDay[msg.sender] = day;
        emit CheckedIn(msg.sender, day);
    }
}
