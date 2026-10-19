import { ChevronIcon, ExternalLinkIcon } from './NetworkIcons';
export default function NetworkLocationHelp() {
  return <details className="network-location-help">
    <summary><ChevronIcon className="network-disclosure-chevron"/>Add your location <span>In Farcaster · no app permissions</span></summary>
    <div>

      <ol>
        <li>Open the Farcaster app on iOS and go to your own profile.</li>
        <li>Tap <strong>Edit profile</strong>, then <strong>Location</strong>. Enter and select your metro area (for example, Sydney, Australia).</li>
        <li>Tap <strong>Save</strong> in Location, then save your profile changes and return here.</li>
      </ol>
      <p>Leave <strong>Enable location prompts</strong> off. Your saved location is public. Network needs no permissions.</p>
      <a href="https://farcaster.xyz" target="_blank" rel="noopener noreferrer">Open Farcaster <ExternalLinkIcon/></a>
      <p className="network-location-note">The map checks public profile locations daily. Changes may take time to appear.</p>
    </div>
  </details>;
}
