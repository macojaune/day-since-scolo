import {GeistSans} from "geist/font/sans";
import {type Session} from "next-auth";
import {SessionProvider} from "next-auth/react";
import {type AppType} from "next/app";

import {api} from "~/utils/api";

import "~/styles/globals.css";
import Script from "next/script";

const MyApp: AppType<{ session: Session | null }> = ({
	                                                     Component,
	                                                     pageProps: {session, ...pageProps},
                                                     }) => {
	return (
	  <>
		  <Script
			defer
			src="https://analytics.marvinl.com/script.js"
			data-website-id="e5e9b232-675e-4172-b463-32c56e9dc567"/>
		  <SessionProvider session={session}>
			  <div className={GeistSans.className}>
				  <Component {...pageProps} />
			  </div>
		  </SessionProvider>    </>
	);
};

export default api.withTRPC(MyApp);
