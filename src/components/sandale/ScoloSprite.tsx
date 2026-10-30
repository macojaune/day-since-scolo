import { SCOLO_VARIANTS } from '~/game/sandale/engine'

const palettes = {
  noir: { body: '#263139', edge: '#10191d', head: '#a84435', legs: '#d5a142', light: '#69777d' },
  bleu: { body: '#427da6', edge: '#183c58', head: '#234d79', legs: '#e4b859', light: '#84b6d2' },
  jaune: { body: '#e0bc43', edge: '#6e4b22', head: '#a34f32', legs: '#a45e2f', light: '#ffdf79' },
  rouge: { body: '#b84e42', edge: '#5c2728', head: '#db7850', legs: '#dca36c', light: '#ed9a76' },
  doré: { body: '#c59a42', edge: '#674b28', head: '#997038', legs: '#eed087', light: '#f2d47d' },
}

// Flat graphic interpretation, not a photograph: a long tapered body, many paired
// legs, two antennae and longer terminal legs. No fangs, textures, or leg animation.
export default function ScoloSprite({ variant }: { variant: number }) {
  const name = SCOLO_VARIANTS[variant] ?? 'noir'
  const color = palettes[name]
  const segments = Array.from({ length: 15 }, (_, index) => {
    const x = 30 + index * 6.4
    const y = 28 + Math.sin(index * 0.35) * 2
    const height = 9 + Math.sin((index / 16) * Math.PI) * 5
    return { x, y, height }
  })
  return <svg viewBox="0 0 160 56" fill="none" aria-hidden="true" data-scolo-color={name}>
    <g stroke={color.legs} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m32 25-10-6-8-1m18 13-10 6-8 1" />
      {segments.map(({ x, y, height }, index) => <path key={index}
        d={`M${x + 2} ${y - height / 3}l-2-7-4-3M${x + 2} ${y + height / 3}l-2 7-4 3`} />)}
      <path d="m133 24 10-8 10-2m-20 17 10 8 10 2" />
    </g>
    <g stroke={color.edge} strokeWidth="1.15">
      {segments.map(({ x, y, height }, index) => <rect key={index} x={x - 3} y={y - height / 2}
        width="7.8" height={height} rx="2.6" fill={color.body} />)}
      <rect x="121" y="20" width="16" height="15" rx="5" fill={color.head} />
    </g>
    <path d="M41 25q35-4 72 0" stroke={color.light} strokeWidth="1.25" strokeLinecap="round" opacity="0.8" />
    <circle cx="132" cy="24.5" r="1.25" fill="#fff3d0" />
    <circle cx="132" cy="30.5" r="1.25" fill="#fff3d0" />
  </svg>
}
