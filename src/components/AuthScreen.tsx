import { useState, type FormEvent } from 'react';
import { LockKeyhole, PencilRuler, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuizStore } from '@/store/useQuizStore';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const login = useQuizStore((s) => s.login);
  const register = useQuizStore((s) => s.register);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const name = username.trim();
    if (name.length < 2 || name.length > 20) {
      setError('用户名需为 2~20 个字符');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') await login(name, password);
      else await register(name, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后再试');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] rounded-[18px] bg-card p-6 shadow-[0_8px_30px_rgba(70,100,160,.12)] sm:p-8">
        <div className="pb-5 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eaf2ff] text-[#4a7bf6]">
            <PencilRuler className="h-7 w-7" />
          </span>
          <h1 className="text-[24px] font-bold tracking-wide">英语单词默写</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            {mode === 'login' ? '登录后开始练习，金币各自独立保存' : '注册账号，闯关拆红包赚金币'}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-[#f1f5fb] p-1">
          {(['login', 'register'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={cn(
                'rounded-lg py-2 text-[14.5px] font-bold transition-all',
                mode === m ? 'bg-white text-[#4a7bf6] shadow-sm' : 'text-muted-foreground',
              )}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <label className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 focus-within:border-primary">
            <UserRound className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              maxLength={20}
              className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
            />
          </label>
          <label className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-3.5 focus-within:border-primary">
            <LockKeyhole className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码（至少 6 位）"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              maxLength={64}
              className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
            />
          </label>

          {error && (
            <p className="rounded-lg bg-[#fdf0ed] px-3 py-2 text-[13.5px] text-[#d1432e]">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-1 w-full" disabled={submitting}>
            {submitting ? '请稍候…' : mode === 'login' ? '登 录' : '注册并登录'}
          </Button>
        </form>

        <p className="mt-4 text-center text-[12.5px] leading-5 text-muted-foreground">
          金币与通关记录保存在服务器账号下
          <br />
          不同账号互不可见
        </p>
      </div>
    </div>
  );
}
