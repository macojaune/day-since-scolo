import digrainImg from '/digrain.png'
import {useEffect, useState} from "react";
import {useQuery} from "@tanstack/react-query";

function App() {
	const [duration, setDuration] = useState(0)
	const {data,error,status} = useQuery({
		queryKey: ['lastTime'],
		queryFn: () =>
		  fetch(import.meta.env.VITE_API_URL + '/lastTime').then((res) => res.text() ),
	})
	console.log(data, error,status)

	useEffect(() => {

		const interval = setInterval(() => {
			const now = new Date()
			const since = new Date(data?.lastTime)
			// @ts-expect-error dates
			setDuration(now - since)
		}, 100);

		return () => clearInterval(interval);

	}, [])

	const seconds = Math.floor(duration / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24)

	return <div className="py-8 px-4 sm:p-8 bg-black h-full w-full">
		<div className={`flex flex-col sm:flex-row gap-5 w-full items-center`}>
			<div className="w-full sm:w-3/5 flex flex-col gap-y-8 items-center justify-center">
				<h1 className="text-4xl leading-5 sm:leading-6 sm:text-8xl text-yellow-400 font-bold text-center ">
					Jou san bèt a mil pat
					<br/>
					<small className="text-sm italic">"Jours sans scolopendre"</small>
				</h1>
				<div className={`grid ${days > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-x-3 w-full sm:w-1/2`}>
					{days > 0 ?
					  <p
						className="flex flex-col justify-center text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
						  {days.toString().padStart(2, '0')} <br/>
						  <small className="text-base sm:text-lg text-center">jours</small>
					  </p>
					  : null}
					<p
					  className="flex flex-col justify-center text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
						{(hours % 24).toString().padStart(2, '0')} <br/>
						<small className="text-base sm:text-lg text-center">heures</small>
					</p>
					<p
					  className="flex flex-col justify-center  text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
						{(minutes % 60).toString().padStart(2, '0')}
						<br/>
						<small className="text-base sm:text-lg text-center">minutes</small>

					</p>
					<p
					  className="flex flex-col justify-center  text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
						{(seconds % 60).toString().padStart(2, '0')}
						<br/>
						<small className="text-base sm:text-lg text-center">sec</small>
					</p>
				</div>
			</div>
			<div className="flex flex-col">
				<img src={digrainImg} alt="digrain"/>
				<span className="text-white text-center">Le sauveur</span>
				<span className="text-lg text-yellow-400 text-center">Pas <i
				  className="italic font-bold text-xl">(encore)</i> sponsorisé.</span>
			</div>
		</div>
		<p className="text-white font-light text-center mt-6">Du coup, si vous avez une maison, <i
		  className="text-orange-500 font-bold">garantie SANS
			scolo</i>,
			pour moi… <a className="text-yellow-400 font-bold hover:underline" href="https://t.me/macojaune">je
				prends</a> !</p>
		<p className="text-white text-center text-sm mt-12">Site créé <u className="underline italic font-bold">dans la
			frustration</u> par <a href="https://marvinl.com">MarvinL.com</a></p>
	</div>

}

export default App
