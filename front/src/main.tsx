import { auth } from '@/services/auth';
import '@/extensions';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/server-state/client';
import { AuthProvider } from '@/providers/auth';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BrowserRouter } from 'react-router';
import './index.css';
const queryClient = createQueryClient();

async function bootstrap() {
  // A temporary connection failure preserves the saved session for the next request.
  await auth.initialize().catch(() => {});

  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

void bootstrap();
