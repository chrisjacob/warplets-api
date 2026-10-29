import type { SVGProps } from 'react';
type IconProps = SVGProps<SVGSVGElement>;
export function ExternalLinkIcon({className='',...props}:IconProps){
  return <svg {...props} className={`network-icon network-external-icon ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M15 3h6v6M10 14 21 3"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg>;
}
export function ChevronIcon({className='',...props}:IconProps){
  return <svg {...props} className={`network-icon network-chevron ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>;
}
