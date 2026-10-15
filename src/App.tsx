import { useEffect } from 'react';
import { useQuizStore } from '@/store/useQuizStore';
import { Home } from '@/components/Home';
import { Quiz } from '@/components/Quiz';
import { Result } from '@/components/Result';
import { AuthScreen } from '@/components/AuthScreen';
import { WrongBookModal } from '@/components/WrongBookModal';
import { Toast } from '@/components/Toast';

export default function App() {
  const view = useQuizStore((s) => s.view);
  const authStatus = useQuizStore((s) => s.authStatus);
  const bootstrapAuth = useQuizStore((s) => s.bootstrapAuth);

  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  if (authStatus === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-[15px] text-muted-foreground">
        正在加载…
      </div>
    );
  }

  if (authStatus === 'guest') {
    return <AuthScreen />;
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[820px] px-4 pb-10 pt-5">
      {view === 'home' && <Home />}
      {view === 'quiz' && <Quiz />}
      {view === 'result' && <Result />}

      <WrongBookModal />
      <Toast />
    </div>
  );
}
