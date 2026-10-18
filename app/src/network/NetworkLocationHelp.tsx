export default function NetworkLocationHelp() {
  return <details className="network-location-help">
    <summary>Add or update your location <span>In Farcaster · no app permissions</span></summary>
    <div>
      <p>Put yourself on the map by updating your public Farcaster profile.</p>
      <ol>
        <li>Open the Farcaster app on iOS and go to your own profile.</li>
        <li>Tap <strong>Edit profile</strong>, then <strong>Location</strong>. Enter and select your metro area (for example, Sydney, Australia).</li>
        <li>Tap <strong>Save</strong> in Location, then save your profile changes and return here.</li>
      </ol>
      <p>You can enter your location manually and leave <strong>Enable location prompts</strong> off. Network needs no profile-write permissions or device location access. Your saved location is public on Farcaster.</p>
      <a href="https://farcaster.xyz" target="_blank" rel="noopener noreferrer">Open Farcaster ↗</a>
      <p className="network-location-note">Network reads your public location during scheduled profile refreshes, targeted daily. Changes will not appear immediately. Only confirmed acceptance signers are included; your location must resolve to a country to appear on the map.</p>
    </div>
  </details>;
}
