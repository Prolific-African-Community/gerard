import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { StyledEngineProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { BrandingProvider } from '../components/branding/BrandingProvider';
import { GerardApplicationProvider } from '@prolific/gerard-core/react';
import { activeGerardApplication } from '../lib/runtime/application-registry';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <StyledEngineProvider injectFirst>
      <Head>
        <title>Gerard Dispatch</title>
        <link rel="icon" href="/logo-gerard.png" />
      </Head>
      <CssBaseline />
      <GerardApplicationProvider application={activeGerardApplication}>
        <BrandingProvider><Component {...pageProps} /></BrandingProvider>
      </GerardApplicationProvider>
    </StyledEngineProvider>
  );
}
