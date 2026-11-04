import { useMutation } from '@tanstack/react-query';
import { auth } from '@/services/auth';

export const useStartCode = () =>
  useMutation({
    mutationFn: (email: string) => auth.start(email),
  });

export const useConfirmCode = () =>
  useMutation({
    mutationFn: (code: string) => auth.confirm(code),
  });
