import { readFile } from 'node:fs/promises'
/* eslint-disable @next/next/no-img-element -- Vercel OG renders PNGs from JSX; next/image cannot run inside Satori. */
import { join } from 'node:path'
import React from 'react'
import { ImageResponse } from 'next/og'
import { socialCardVersion } from './preview-data'
import { SOCIAL_HEIGHT, SOCIAL_TITLE, SOCIAL_WIDTH, type SocialCardData } from '../../utils/social-preview'

const yellow = '#facc15'
const numberFormat = new Intl.NumberFormat('fr-FR')
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[]> | undefined
const images = new Map<string, Promise<string>>()
let cached: { version: string; bytes: Promise<Buffer> } | undefined

function loadFonts() {
  return fonts ??= Promise.all(([['Regular', 400], ['Bold', 700]] as const).map(async ([name, weight]) => ({
    name: 'Geist', data: await readFile(join(process.cwd(), `node_modules/geist/dist/fonts/geist-sans/Geist-${name}.ttf`)), weight, style: 'normal' as const,
  }))).catch(error => { fonts = undefined; throw error })
}

async function weaponImage(weapon: NonNullable<SocialCardData['weapon']>) {
  let image = images.get(weapon)
  if (!image) {
    image = readFile(join(process.cwd(), 'public', `${weapon}.png`)).then(bytes => `data:image/png;base64,${bytes.toString('base64')}`)
    images.set(weapon, image)
    void image.catch(() => images.delete(weapon))
  }
  return image
}

/** Deterministic JSX rendered by Vercel OG; no external image or font fetches. */
export function SocialPreviewImage({ data, image }: { data: SocialCardData; image?: string }) {
  const count = data.predictionCount
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT, background: '#000', color: '#fff', fontFamily: 'Geist', padding: '36px 54px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1.5 }}>BÈT</span>
          <span style={{ fontSize: 19, fontWeight: 700, color: yellow, marginLeft: 10, marginTop: 15 }}>a milpat</span>
        </div>
        <span style={{ color: '#bcbcbc', fontSize: 21 }}>scolo.marvinl.com</span>
      </div>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 690, color: yellow, fontSize: 78, lineHeight: 1.02, letterSpacing: -2.5, fontWeight: 700 }} aria-label={SOCIAL_TITLE}>
          <span>Parie sur la</span>
          <span>prochaine</span>
          <span>rencontre.</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 370 }}>
          {image && <img src={image} width={370} height={250} alt="" style={{ objectFit: data.weapon === 'sandale' ? 'cover' : 'contain' }} />}
          <span style={{ color: '#bcbcbc', fontSize: 18 }}>La dernière arme du crime</span>
          <span style={{ color: '#fff', fontSize: 30, fontWeight: 700, marginTop: 7 }}>{data.weaponLabel}</span>
        </div>
      </div>
      <div style={{ display: 'flex', height: 125, marginLeft: -54, marginRight: -54, padding: '0 54px', background: yellow, color: '#000', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {count !== null ? <>
            <span style={{ fontSize: 72, lineHeight: 1, fontWeight: 700, letterSpacing: -2 }}>{count >= 1000000 ? new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(count) : numberFormat.format(count)}</span>
            <span style={{ fontSize: 29, fontWeight: 700, marginLeft: 18 }}>pari{count === 1 ? '' : 's'} validé{count === 1 ? '' : 's'}</span>
          </> : <span style={{ fontSize: 32, fontWeight: 700 }}>À toi de jouer.</span>}
        </div>
        <span style={{ fontSize: 22 }}>{data.daysWithoutAppearance === null ? 'Des Zikak fictifs, du vrai suspense.' : `${numberFormat.format(data.daysWithoutAppearance)} jour${data.daysWithoutAppearance === 1 ? '' : 's'} sans scolo`}</span>
      </div>
    </div>
  )
}

export async function renderSocialImage(data: SocialCardData): Promise<Buffer> {
  const version = socialCardVersion(data)
  if (cached?.version === version) return cached.bytes
  const bytes = (async () => {
    const [fontData, image] = await Promise.all([loadFonts(), data.weapon ? weaponImage(data.weapon) : undefined])
    const response = new ImageResponse(<SocialPreviewImage data={data} image={image} />, { width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT, fonts: fontData })
    return Buffer.from(await response.arrayBuffer())
  })()
  cached = { version, bytes }
  void bytes.catch(() => { if (cached?.bytes === bytes) cached = undefined })
  return bytes
}
