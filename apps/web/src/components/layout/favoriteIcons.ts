import {
  CircleUserRound,
  FileText,
  Folder,
  Building2,
  Layers,
  LayoutDashboard,
  RefreshCcw,
  SquareCheck,
  Star,
  Tag,
  Target,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

// The icon of each kind of favorite in the sidebar.
const ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  issue: SquareCheck,
  project: Target,
  customView: Layers,
  cycle: RefreshCcw,
  document: FileText,
  label: Tag,
  projectLabel: Tag,
  customer: Building2,
  dashboard: LayoutDashboard,
  team: Users,
  user: User,
  predefinedView: CircleUserRound,
};

export const favoriteIcon = (type: string): LucideIcon => ICONS[type] ?? Star;
