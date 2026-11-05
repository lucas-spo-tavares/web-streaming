import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/providers/auth';
import { Library } from '@/views/Library/Library';
import { Player } from '@/views/Player/Player';
import { Login } from '@/views/Login/Login';
import { AppTemplate } from '@/templates/AppTemplate';

export function AppRoutes() {
  const { session, logout } = useAuth();

  if (!session) return <Login />;

  return (
    <Routes>
      <Route element={<AppTemplate logout={logout} />}>
        <Route element={<Library />}>
          <Route index element={null} />
          <Route path="watch/:fileName" element={<Player />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
