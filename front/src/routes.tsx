import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/providers/auth';
import { Library } from '@/views/Library';
import { Player } from '@/views/Player';
import { Login } from '@/views/Login';

export function AppRoutes() {
  const { session, logout } = useAuth();

  if (!session) return <Login />;

  return (
    <Routes>
      <Route element={<Library logout={logout} />}>
        <Route index element={null} />
        <Route path="watch/:fileName" element={<Player />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
