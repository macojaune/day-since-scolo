import { signIn, signOut, useSession } from "next-auth/react";
import Head from "next/head";

import { api } from "~/utils/api";
import {useEffect, useState} from "react";
import BetForm from "~/components/BetForm";
import SpawnTable from "~/components/SpawnTable";
import Image from "next/image";
import toolImg from "/public/digrain.png";
export default function Home() {

  const [duration, setDuration] = useState(0);
   const { data } = api.app.getLatest.useQuery({
     // queryKey: ["encounters"],
     // queryFn: async () =>
     //   axios
     //     .get(import.meta.env.VITE_API_URL + "/lastTime")
     //     .then((res) => res.data),
   });

   useEffect(() => {
     const interval = setInterval(() => {
       const now = new Date();
       const since = new Date(data?.[0]?.createdAt);
       // @ts-expect-error dates
       setDuration(now - since);
     }, 100);

     return () => clearInterval(interval);
   }, [data]);

   const seconds = Math.floor(duration / 1000);
   const minutes = Math.floor(seconds / 60);
   const hours = Math.floor(minutes / 60);
   const days = Math.floor(hours / 24);

   return (
     <div className="py-8 px-4 sm:p-8 bg-black h-full w-full">
         <Head>
             <title>Jou san bèt a mil pat</title>
             <meta charSet="UTF-8"/>
             <link rel="icon" type="image/svg+xml" href="/vite.svg"/>
             <meta name="viewport" content="width=device-width, initial-scale=1.0"/>

         </Head>
         <div
           className={`flex flex-col sm:flex-row sm:justify-evenly gap-5 w-full items-center`}
         >
             <div className="w-full sm:w-3/5 flex flex-col gap-y-8 items-center justify-center">
           <h1 className="text-4xl leading-5 sm:leading-6 sm:text-8xl text-yellow-400 font-bold text-center ">
             Jou san bèt a mil pat
             <br />
             <small className="text-sm italic">"Jours sans scolopendre"</small>
           </h1>
           <div
             className={`grid ${days > 0 ? "grid-cols-4" : "grid-cols-3"} gap-x-3 w-full sm:w-1/2`}
           >
             {days > 0 ? (
               <p className="flex flex-col justify-center text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
                 {days.toString().padStart(2, "0")} <br />
                 <small className="text-base sm:text-lg text-center">
                   jours
                 </small>
               </p>
             ) : null}
             <p className="flex flex-col justify-center text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
               {(hours % 24).toString().padStart(2, "0")} <br />
               <small className="text-base sm:text-lg text-center">heures</small>
             </p>
             <p className="flex flex-col justify-center  text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
               {(minutes % 60).toString().padStart(2, "0")}
               <br />
               <small className="text-base sm:text-lg text-center">
                 minutes
               </small>
             </p>
             <p className="flex flex-col justify-center  text-center bg-white p-4 aspect-square rounded-md text-4xl sm:text-7xl text-black ">
               {(seconds % 60).toString().padStart(2, "0")}
               <br />
               <small className="text-base sm:text-lg text-center">sec</small>
             </p>
           </div>
           {/*<BetForm spawn={data?.[0]} />*/}
           {data ? <SpawnTable data={data} /> : null}
         </div>
         <div className="flex flex-col">
           <Image
             // @ts-expect-error promise as dynamic import
             src={data?.tool ? import(`/public/${data.tool}.png`) : toolImg}
             alt={data?.tool ?? "Digrain"}
             className="object-contain object-center"
           />
           <span className="text-white text-center sm:mt-2">L'arme du jour</span>
           <span className="text-lg text-yellow-400 text-center">
             On fait avec ce qu'on à…
           </span>
         </div>
       </div>
       <p className="text-white font-light text-center mt-6">
         Du coup, si vous avez une maison,{" "}
         <i className="text-orange-500 font-bold">garantie SANS scolo</i>, pour
         moi…{" "}
         <a
           className="text-yellow-400 font-bold hover:underline"
           href="https://t.me/macojaune"
         >
           je prends
         </a>{" "}
         !
       </p>
       <p className="text-white text-center text-sm mt-12">
         Site créé{" "}
         <u className="underline italic font-bold">dans la frustration</u> par{" "}
         <a href="https://marvinl.com" className="font-bold hover:underline">
           MarvinL.com
         </a>
       </p>
     </div>
   );
}

function AuthShowcase() {
  const { data: sessionData } = useSession();

  const { data: secretMessage } = api.post.getSecretMessage.useQuery(
    undefined, // no input
    { enabled: sessionData?.user !== undefined }
  );

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <p className="text-center text-2xl text-white">
        {sessionData && <span>Logged in as {sessionData.user?.name}</span>}
        {secretMessage && <span> - {secretMessage}</span>}
      </p>
      <button
        className="rounded-full bg-white/10 px-10 py-3 font-semibold text-white no-underline transition hover:bg-white/20"
        onClick={sessionData ? () => void signOut() : () => void signIn()}
      >
        {sessionData ? "Sign out" : "Sign in"}
      </button>
    </div>
  );
}
