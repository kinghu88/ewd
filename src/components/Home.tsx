import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  BookText,
  Coins,
  GraduationCap,
  Library,
  LogOut,
  PencilRuler,
  Store,
  Swords,
  Upload,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useQuizStore } from '@/store/useQuizStore';
import { CATEGORIES, type CategoryMeta, type LevelMeta } from '@/lib/data';
import { readJsonFile } from '@/lib/data';
import { getBookCount } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { GradeUnitPanel } from './GradeUnitPanel';
import { RewardsModal } from './RewardsModal';
import { ShopModal } from './shop/ShopModal';

/** 各学段卡片的图标与配色 */
const CATEGORY_STYLE: Record<
  CategoryMeta['key'],
  { icon: typeof PencilRuler; chip: string; hover: string }
> = {
  primary: {
    icon: PencilRuler,
    chip: 'bg-[#eaf2ff] text-[#4a7bf6]',
    hover: 'hover:border-[#4a7bf6] hover:bg-[#f3f8ff]',
  },
  junior: {
    icon: BookText,
    chip: 'bg-[#e7f7ef] text-[#18a068]',
    hover: 'hover:border-[#18a068] hover:bg-[#f2fbf7]',
  },
  senior: {
    icon: Library,
    chip: 'bg-[#f0ebff] text-[#7a5af0]',
    hover: 'hover:border-[#7a5af0] hover:bg-[#f7f4ff]',
  },
  college: {
    icon: GraduationCap,
    chip: 'bg-[#fff2e0] text-[#e08a1e]',
    hover: 'hover:border-[#e08a1e] hover:bg-[#fff9f0]',
  },
};

export function Home() {
  const settings = useQuizStore((s) => s.settings);
  const setSetting = useQuizStore((s) => s.setSetting);
  const startQuiz = useQuizStore((s) => s.startQuiz);
  const setBookOpen = useQuizStore((s) => s.setBookOpen);
  const bookVersion = useQuizStore((s) => s.bookVersion);
  const user = useQuizStore((s) => s.user);
  const logout = useQuizStore((s) => s.logout);
  const rewardsTick = useQuizStore((s) => s.rewardsTick);
  const coinCount = useQuizStore((s) => s.coins);
  const refreshShop = useQuizStore((s) => s.refreshShop);

  /** 当前选中的学段；null = 展示学段选择 */
  const [category, setCategory] = useState<CategoryMeta | null>(null);
  /** 当前打开了单元选择面板的年级 / 考试；null = 展示学段或年级列表 */
  const [level, setLevel] = useState<LevelMeta | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bookCount = useMemo(() => getBookCount(), [bookVersion]);
  // 金币 / 道具库存以服务端为准：首次进入、红包到账（rewardsTick）后刷新
  useEffect(() => {
    void refreshShop();
  }, [rewardsTick, refreshShop]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复导入同一文件
    if (!file) return;
    setError(null);
    try {
      const words = await readJsonFile(file);
      startQuiz(words, `自定义词库：${file.name}`);
    } catch {
      setError({ message: 'JSON 解析失败或没有有效单词，请检查文件格式' });
    }
  };

  if (level) {
    return <GradeUnitPanel level={level} onBack={() => setLevel(null)} />;
  }

  return (
    <div className="rounded-[18px] bg-card p-5 shadow-[0_8px_30px_rgba(70,100,160,.12)] sm:p-6">
      <div className="flex items-center justify-end gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-[#eaf2ff] px-3 py-1 text-[13px] font-bold text-[#4a7bf6]">
          <UserRound className="h-3.5 w-3.5" />
          {user?.username ?? ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-full px-2.5 text-[12.5px] text-muted-foreground"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <LogOut className="h-3.5 w-3.5" />
          退出
        </Button>
      </div>
      <header className="pb-4 pt-2 text-center">
        <h1 className="text-[26px] font-bold tracking-wide sm:text-[34px]">英语单词默写</h1>
        <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
          看中文意思，在四线格里写出英文单词
          <br />
          填完所有字母后点「确认」提交，每个单词只能确认一次哦
        </p>
      </header>

      {category === null ? (
        <>
          <p className="text-[15px] font-bold">① 选择学段</p>
          <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CATEGORIES.map((cat) => {
              const style = CATEGORY_STYLE[cat.key];
              const Icon = style.icon;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    'flex flex-col items-center gap-2.5 rounded-[14px] border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-2 py-5 transition-all hover:-translate-y-0.5',
                    style.hover,
                  )}
                >
                  <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', style.chip)}>
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="text-[17px] font-bold text-foreground">{cat.label}</span>
                  <span className="text-center text-[12px] leading-4 text-muted-foreground">
                    {cat.description}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 pb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 rounded-full p-0"
              onClick={() => setCategory(null)}
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
            </Button>
            <p className="text-[15px] font-bold">
              ① {category.label} · 选择{category.key === 'college' ? '考试' : '年级'}，再勾选单元
            </p>
          </div>
          <div
            className={cn(
              'my-4 grid gap-3',
              category.key === 'college' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3',
            )}
          >
            {category.levels.map((item) => (
              <button
                key={item.base}
                type="button"
                onClick={() => setLevel(item)}
                className="rounded-[14px] border-[1.5px] border-[#dce7f6] bg-[#f8fbff] px-2 py-4 text-center text-[16px] font-bold text-primary transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-[#eaf2ff]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="my-4 flex items-center gap-3 text-[13px] text-muted-foreground">
        <span className="h-px flex-1 bg-[#e0e8f4]" />
        或者
        <span className="h-px flex-1 bg-[#e0e8f4]" />
      </div>

      <p className="text-[15px] font-bold">② 手动导入本地 JSON 词库</p>
      <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={handleFile} />
      <Button
        size="lg"
        variant="secondary"
        className="mt-3 w-full"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-[18px] w-[18px]" />
        导入 JSON 文件
      </Button>

      {error && (
        <div className="mt-4 rounded-xl border border-[#f6d9c8] bg-[#fdf3ed] p-3.5 text-[14px] leading-7 text-[#a85a2f]">
          {error.message}。正确格式：
          <code className="rounded bg-[#f7e6db] px-1.5 py-0.5 text-[13px]">{`[{ "name": "sport", "trans": ["体育运动"] }]`}</code>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2.5">
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-[14.5px] text-muted-foreground">
            <Switch
              checked={settings.shuffle}
              onCheckedChange={(v) => setSetting({ shuffle: v })}
              aria-label="打乱单词顺序"
            />
            打乱单词顺序（随机出题）
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-[14.5px] text-muted-foreground">
            <Switch
              checked={settings.timed}
              onCheckedChange={(v) => setSetting({ timed: v })}
              aria-label="限时模式"
            />
            限时模式（每词 30 秒，超时记为未答并自动进入下一词）
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-[14.5px] text-muted-foreground">
            <Switch
              checked={settings.sound}
              onCheckedChange={(v) => setSetting({ sound: v })}
              aria-label="连击音效"
            />
            连击音效（Double Kill、ACE 等播报音效，默认开启）
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-[14.5px] text-muted-foreground">
            <Switch
              checked={settings.challenge}
              onCheckedChange={(v) => setSetting({ challenge: v })}
              aria-label="闯关模式"
            />
            <Swords className="h-4 w-4 text-[#e08a1e]" />
            闯关模式（一个单元为一关、三颗心，闯完所选单元可拆幸运红包）
          </label>
        </div>
        <div className="flex flex-col gap-2.5">
          <Button variant="outline" onClick={() => setShopOpen(true)}>
            <Store className="h-[18px] w-[18px] text-[#e08a1e]" />
            金币商店
            <Badge className="border-[#f3d8a4] bg-[#fff3da] px-1.5 text-[#d97706] hover:bg-[#fff3da]">
              <Coins className="mr-0.5 h-3 w-3" />
              {coinCount}
            </Badge>
          </Button>
          <Button variant="outline" onClick={() => setRewardsOpen(true)}>
            <Coins className="h-[18px] w-[18px] text-[#e08a1e]" />
            我的奖励
          </Button>
          <Button variant="outline" onClick={() => setBookOpen(true)}>
            <BookText className="h-[18px] w-[18px]" />
            错词本
            {bookCount > 0 && (
              <Badge variant="destructive" className="px-1.5">
                {bookCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      <RewardsModal open={rewardsOpen} onOpenChange={setRewardsOpen} />
      <ShopModal open={shopOpen} onOpenChange={setShopOpen} />

      <ul className="ml-5 mt-4 list-disc text-[13.5px] leading-7 text-muted-foreground">
        <li>
          词库 JSON 放在 public 目录（开发时放在站点根目录），按「学段 + 年级/考试 + 册别 + 单元」命名：
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">grade1a-u1.json</code>
          （小学一年级上册 1 单元，a=上册，b=下册）、
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">junior1a-u1.json</code>
          （初一上册）、
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">senior2b-u3.json</code>
          （高二下册）、
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">cet4-u1.json</code>
          （大学四级 1 单元，考试不分册）；旧的整年级文件如
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">grade1.json</code>
          、以及
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">cet6.json</code>
          均兼容。
        </li>
        <li>
          单词格式：
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[13px]">{`[{"name":"sport","trans":["体育运动"]}]`}</code>
        </li>
        <li>直接双击打开页面时浏览器可能禁止读取本地文件，请改用「导入 JSON」。</li>
      </ul>
    </div>
  );
}
