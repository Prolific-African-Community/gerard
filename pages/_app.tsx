import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { StyledEngineProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <StyledEngineProvider injectFirst>
      <Head>
        <title>Gerard Dispatch</title>
        <link rel="icon" href="/logo-gerard.png" />
      </Head>
      <CssBaseline />
      <Component {...pageProps} />
    </StyledEngineProvider>
  );
}
