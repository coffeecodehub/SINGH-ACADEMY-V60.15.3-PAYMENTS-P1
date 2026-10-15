'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useAuth} from './auth/AuthProvider';
import {getPublicSiteContent,invalidatePublicSiteContent} from '../lib/publicSiteContent';
import {websiteConfig} from '../lib/websiteConfig';
import {useHydrated} from '../lib/useHydrated';
export type WebsiteConfig={text:Record<string,string>;images:{key:string;src:string;url:string;fileId?:string|null;position?:string}[]};
const empty:WebsiteConfig={text:{},images:[]};
const Context=createContext<WebsiteConfig>(empty);
/** No visible wrapper. Empty configuration is the exact retained public copy and original imagery. */
export function WebsiteContentProvider({children}:{children:ReactNode}){const{user,ready}=useAuth();const[value,setValue]=useState<WebsiteConfig>(empty);useEffect(()=>{let active=true;const refresh=(force=false)=>getPublicSiteContent(force).then(content=>{if(active)setValue(websiteConfig(content.websiteContent))}).catch(()=>{});refresh();const changed=()=>{invalidatePublicSiteContent();refresh(true);};const focus=()=>{if(document.visibilityState==='visible')refresh();};window.addEventListener('sa-website-content',changed);window.addEventListener('focus',focus);return()=>{active=false;window.removeEventListener('sa-website-content',changed);window.removeEventListener('focus',focus);};},[ready,user?.id]);return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useWebsiteContent(){const value=useContext(Context),hydrated=useHydrated();return hydrated?value:empty;}
export function websiteText(config:WebsiteConfig,key:string,fallback:string):string{return typeof config.text?.[key]==='string'?config.text[key]:fallback;}
