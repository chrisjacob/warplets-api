import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './routes';
import './style.css';

const cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:15_000,refetchOnWindowFocus:false},
  mutations:{retry:false}}});
createRoot(document.getElementById('app')!).render(<StrictMode>
  <QueryClientProvider client={cache}><RouterProvider router={router}/></QueryClientProvider>
</StrictMode>);
