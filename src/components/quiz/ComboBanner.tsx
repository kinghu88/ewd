import type { ComboTier } from '@/lib/combo';
import { cn } from '@/lib/utils';

export interface ComboAnnounce {
  /** 每次播报的唯一标识，用于重启动画（连续触发同段位也能重播） */
  key: number;
  tier: ComboTier;
}

interface ComboBannerProps {
  announce: ComboAnnounce | null;
}

/**
 * 连击播报：屏幕中央大字横幅（DOUBLE KILL / TRIPLE KILL …）。
 * 用 key 重挂载，保证每次触发都重新播放弹射动画；约 1.3s 后由父组件清空。
 */
export function ComboBanner({ announce }: ComboBannerProps) {
  if (!announce) return null;
  const { tier } = announce;
  const legendary = tier.id === 'legendary';

  return (
    <div className="combo-layer" aria-live="polite">
      <div
        key={announce.key}
        className={cn('combo-banner', legendary && 'combo-banner-legendary')}
        style={{ ['--combo-color' as string]: tier.color }}
      >
        <div className="combo-en">{tier.en}</div>
        <div className="combo-zh">{tier.zh}</div>
      </div>
    </div>
  );
}
