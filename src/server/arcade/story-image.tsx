/* eslint-disable @next/next/no-img-element -- ImageResponse renders image data; next/image needs a browser. */
import React from 'react'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import type { ShareBoard } from '../../game/sandale/sharing'
import { formatDuration } from '../../game/sandale/engine'

export const STORY_WIDTH = 1080
export const STORY_HEIGHT = 1920
const yellow = '#facc15'
let assets: Promise<{ fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[]; sandal: string }> | undefined
function loadAssets() {
  return assets ??= (async () => ({
    fonts: await Promise.all(([['Regular', 400], ['Bold', 700]] as const).map(async ([name, weight]) => ({ name: 'Geist', data: await readFile(join(process.cwd(), `node_modules/geist/dist/fonts/geist-sans/Geist-${name}.ttf`)), weight, style: 'normal' as const }))),
    sandal: `data:image/png;base64,${(await readFile(join(process.cwd(), 'public/sandale.png'))).toString('base64')}`,
  }))().catch(error => { assets = undefined; throw error })
}

/** Server-derived leaderboard only. No query-string name, rank, or score is trusted. */
export async function renderArcadeStory(board: ShareBoard, current?: { elapsedMs: number; crushed: number }, preview = true) {
  const { fonts, sandal } = await loadAssets()
  const score = board.me ?? current
  const response = new ImageResponse(<div style={{ display: 'flex', flexDirection: 'column', width: STORY_WIDTH, height: STORY_HEIGHT, padding: '170px 80px 190px', background: '#000', color: '#fff', fontFamily: 'Geist' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 17 }}><span style={{ fontSize: 82, fontWeight: 700, letterSpacing: -3 }}>BÈT</span><span style={{ color: yellow, fontSize: 32, fontWeight: 700 }}>a milpat</span></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 95 }}>
      <div style={{ display: 'flex', flexDirection: 'column', color: yellow, fontSize: 112, fontWeight: 700, lineHeight: 0.98, letterSpacing: -4 }}><span>Qui fait</span><span>mieux ?</span></div>
      <img src={sandal} width={300} height={290} alt="" style={{ objectFit: 'contain', transform: 'rotate(-12deg)' }} />
    </div>
    {score && <div style={{ display: 'flex', flexDirection: 'column', marginTop: 70, paddingBottom: 54, borderBottom: '2px solid #38342a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: '#bcbcbc', fontSize: 31 }}><span>Ma partie</span>{board.me && <span style={{ color: yellow }}>Top {board.me.rank}</span>}</div>
      <span style={{ fontSize: 130, fontWeight: 700, lineHeight: 1.1, marginTop: 15, letterSpacing: -4 }}>{formatDuration(score.elapsedMs)}</span>
    </div>}
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: score ? 48 : 100 }}>
      <span style={{ fontSize: 42, fontWeight: 700, marginBottom: 20 }}>Le classement</span>
      {board.entries.slice(0, 3).map(entry => <div key={entry.rank} style={{ display: 'flex', gap: 22, alignItems: 'center', minHeight: 112, borderBottom: '1px solid #38342a', color: entry.isMe ? yellow : '#fff' }}>
        <span style={{ width: 40, color: yellow, fontSize: 40, fontWeight: 700 }}>{entry.rank}</span>
        <span style={{ fontSize: 34, flex: 1 }}>{entry.name.length > 22 ? `${entry.name.slice(0, 21)}…` : entry.name}</span>
        <span style={{ fontSize: 38, fontWeight: 700 }}>{formatDuration(entry.elapsedMs)}</span>
      </div>)}
      {!board.entries.length && <span style={{ fontSize: 34, color: '#bcbcbc', marginTop: 18 }}>La première place t’attend.</span>}
    </div>
    <div style={{ display: 'flex', flex: 1 }} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 40 }}><span style={{ color: yellow, fontSize: 42, fontWeight: 700 }}>scolo.marvinl.com</span>{preview && <span style={{ color: '#bcbcbc', fontSize: 24 }}>Aperçu local</span>}</div>
  </div>, { width: STORY_WIDTH, height: STORY_HEIGHT, fonts })
  return Buffer.from(await response.arrayBuffer())
}
