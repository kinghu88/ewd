import { useQuizStore } from '@/store/useQuizStore';
import { cn } from '@/lib/utils';

/** 轻提示：由 store.toast 驱动，2.2 秒后自动消失 */
export function Toast() {
  const toast = useQuizStore((s) => s.toast);
  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-9 left-1/2 z-[99] max-w-[88vw] -translate-x-1/2 rounded-full px-5 py-3 text-center text-[14.5px] text-white transition-all duration-200',
        'bg-[rgba(40,55,85,.92)]',
        toast
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-5 opacity-0',
      )}
    >
      {toast}
    </div>
  );
}
