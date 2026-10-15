import './styles.css';
import {WebsiteContentProvider} from '../components/WebsiteContent';
import {Suspense} from 'react';
import {headers} from 'next/headers';
import {AuthProvider} from '../components/auth/AuthProvider';
import SiteAccessGate from '../components/auth/SiteAccessGate';
import NavigationFeedback from '../components/NavigationFeedback';
import CatalogWarmup from '../components/CatalogWarmup';
import {SNAPSHOT_HEADER} from '../lib/server/pageSession';
export const dynamic='force-dynamic';
export const metadata={title:'Singh Academy | Master the Art of Resolution',description:'Executive education in negotiation, mediation, leadership and cross-cultural communication.'};
export default async function RootLayout({children}:{children:React.ReactNode}){
 const raw=(await headers()).get(SNAPSHOT_HEADER);let initialSession=null;
 try{if(raw)initialSession=JSON.parse(decodeURIComponent(raw));}catch{}
 return <html lang="en" data-scroll-behavior="smooth"><body><AuthProvider initialSession={initialSession}><Suspense fallback={null}><NavigationFeedback/></Suspense><SiteAccessGate><WebsiteContentProvider><Suspense fallback={<div role="status" style={{padding:40}}>Loading Singh Academy…</div>}>{children}</Suspense><CatalogWarmup/></WebsiteContentProvider></SiteAccessGate></AuthProvider></body></html>;
}
