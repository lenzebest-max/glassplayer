// Inline SVG icons (stroke-based, 24x24). Static strings only.
const svg = (body, { fill = false, size = 20 } = {}) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`;

export const icons = {
  play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>', { fill: true }),
  pause: svg('<rect x="6" y="4" width="4.2" height="16" rx="1.4"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.4"/>', { fill: true }),
  next: svg('<path d="M5 5.2v13.6a.8.8 0 0 0 1.25.66L16 12.66a.8.8 0 0 0 0-1.32L6.25 4.54A.8.8 0 0 0 5 5.2z"/><rect x="17" y="4.5" width="2.6" height="15" rx="1"/>', { fill: true }),
  prev: svg('<path d="M19 5.2v13.6a.8.8 0 0 1-1.25.66L8 12.66a.8.8 0 0 1 0-1.32l9.75-6.8A.8.8 0 0 1 19 5.2z"/><rect x="4.4" y="4.5" width="2.6" height="15" rx="1"/>', { fill: true }),
  shuffle: svg('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
  repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  repeatOne: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>'),
  volume: svg('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
  volumeLow: svg('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
  mute: svg('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  import: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  export: svg('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>'),
  settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  queue: svg('<path d="M3 6h13M3 12h13M3 18h9"/><path d="M17 15v6l5-3z"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>', { fill: true }),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  square: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  home: svg('<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'),
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  heart: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  transfer: svg('<path d="M7 7h13l-4-4"/><path d="M17 17H4l4 4"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  spotify: svg('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.57.2.86zm1.22-2.73a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07zm.1-2.84C14.7 8.92 9.38 8.74 6.3 9.68a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.87 13.1 1.33a.94.94 0 0 1-.96 1.62z"/>', { fill: true }),
  apple: svg('<path d="M16.37 12.67c-.02-2.25 1.84-3.33 1.92-3.38-1.05-1.53-2.68-1.74-3.26-1.76-1.39-.14-2.71.82-3.42.82-.7 0-1.79-.8-2.94-.78-1.51.02-2.91.88-3.69 2.24-1.57 2.73-.4 6.77 1.13 8.98.75 1.08 1.64 2.3 2.81 2.25 1.13-.05 1.55-.73 2.92-.73 1.36 0 1.75.73 2.94.71 1.21-.02 1.98-1.1 2.72-2.19.86-1.25 1.21-2.47 1.23-2.53-.03-.01-2.36-.9-2.38-3.58zM14.13 6.06c.62-.75 1.04-1.8.93-2.84-.9.04-1.98.6-2.62 1.35-.58.66-1.08 1.72-.94 2.75 1 .08 2.02-.51 2.63-1.26z"/>', { fill: true }),
  discord: svg('<path d="M19.6 5.3A17.6 17.6 0 0 0 15.3 4l-.55 1.1a16.3 16.3 0 0 0-5.5 0L8.7 4a17.6 17.6 0 0 0-4.3 1.3C1.7 9.4.95 13.4 1.33 17.3a17.8 17.8 0 0 0 5.3 2.7l1.14-1.85a11.5 11.5 0 0 1-1.8-.86l.44-.34a12.6 12.6 0 0 0 11.2 0l.44.34c-.57.34-1.18.63-1.8.86L17.37 20a17.8 17.8 0 0 0 5.3-2.7c.45-4.5-.77-8.48-3.07-12zM8.5 14.9c-1.04 0-1.9-.96-1.9-2.13s.84-2.13 1.9-2.13 1.92.96 1.9 2.13c0 1.17-.84 2.13-1.9 2.13zm7 0c-1.04 0-1.9-.96-1.9-2.13s.84-2.13 1.9-2.13 1.92.96 1.9 2.13c0 1.17-.84 2.13-1.9 2.13z"/>', { fill: true }),
  logo: `<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6a8ff"/><stop offset=".55" stop-color="#7c6cff"/><stop offset="1" stop-color="#ff7ab6"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="9" fill="url(#lg)" opacity=".9"/><rect x="2.5" y="2.5" width="27" height="27" rx="8.5" fill="none" stroke="#fff" stroke-opacity=".45"/><path d="M13 21.5V11l9-1.8v10" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11" cy="21.5" r="2.4" fill="#fff"/><circle cx="20" cy="19.2" r="2.4" fill="#fff"/></svg>`,
};

export const icon = (name, size) => (size ? icons[name].replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`) : icons[name]);
