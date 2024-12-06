'use client'
import { Encounter } from '~/server/db/schema'
import Image from 'next/image'
import toolImg from '../../public/digrain.png'
const imageDetails = {
  digrain: { width: 500, height: 900 },
  capes: { width: 207, height: 749 },
  coutelas: { width: 500, height: 500 },
  sandale: { width: 1120, height: 1120 },
}
const ToolPicture = ({ encounter }: { encounter?: Encounter }) => {
  return (
    <div className="flex flex-col items-center justify-center">
      <Image
        src={encounter?.tool ? `/${encounter?.tool}.png` : toolImg}
        alt={encounter?.tool ?? 'Digrain'}
        className="object-contain object-center"
        width={imageDetails[encounter?.tool ?? 'digrain'].width}
        height={imageDetails[encounter?.tool ?? 'digrain'].height}
      />
      <span className="text-center text-xl text-white sm:mt-2">
        L'arme du jour
      </span>
      <span className="text-center text-base text-yellow-400">
        On fait avec ce qu'on à…
      </span>
    </div>
  )
}
export default ToolPicture
