import { useRef } from 'react';
import { ExternalLinkIcon } from './NetworkIcons';
export default function NetworkLocationHelp() {
  const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement>(null), title=useRef<HTMLHeadingElement>(null);
  return <><button ref={trigger} className="network-location-cta network-flat-cta" onClick={()=>{dialog.current?.showModal();title.current?.focus({preventScroll:true});}}>Add your location</button>
    <dialog onClose={()=>trigger.current?.focus()} ref={dialog} className="network-location-modal" aria-labelledby="network-location-title" onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.current?.close();}}}>
      <div className="network-modal-heading"><h2 ref={title} tabIndex={-1} id="network-location-title">Add your location</h2><button aria-label="Close location instructions" onClick={()=>dialog.current?.close()}>×</button></div>
      <ol><li>Open the Farcaster app on iOS and go to your profile.</li><li>Tap <strong>Edit profile → Location</strong>, then select your metro area.</li><li>Save your location, then save your profile.</li></ol>
      <p>Your location is public. No app permissions needed. Location prompts can stay off.</p>
      <a className="network-flat-cta" href="https://farcaster.xyz" target="_blank" rel="noopener noreferrer">Open Farcaster <ExternalLinkIcon/></a>
      <p className="network-location-note">Updates appear after the next profile refresh.</p>
    </dialog></>;
}
