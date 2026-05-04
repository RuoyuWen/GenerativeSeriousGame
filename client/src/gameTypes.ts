export type StructureId = 1 | 2 | 3 | 4 | 5;

export interface BibleEntity {
  id: string;
  name: string;
  role: string;
  visualAndPersonality: string;
}

export interface BibleScene {
  id: string;
  name: string;
  synopsis: string;
  imagePromptAnchors: string;
}

export interface Bible {
  characters: BibleEntity[];
  scenes: BibleScene[];
}

export interface ChapterMeta {
  index: number;
  bookNodeId: string;
  title: string;
  chapterStructureId: StructureId;
  structureRationale: string;
  skeletonBeats: string[];
}

export interface BookEdge {
  from: string;
  to: string;
}

export interface GameChoice {
  id: string;
  label: string;
  nextNodeId?: string;
  nextChapterIndex?: number;
}

export interface GameNode {
  nodeId: string;
  narration: string;
  dialogue?: string[];
  npcIds: string[];
  sceneId: string;
  imageImportant: boolean;
  scenePromptForImage: string;
  choices: GameChoice[];
  imageDataUrl?: string;
  imageStatus?: 'idle' | 'loading' | 'done' | 'error';
  imageError?: string;
}

export interface ChapterContent {
  meta: ChapterMeta;
  nodes: GameNode[];
}

export interface BookPlan {
  bookStructureId: StructureId;
  bookStructureRationale: string;
  visualStyle: string;
  bible: Bible;
  chaptersMeta: ChapterMeta[];
  bookEdges: BookEdge[];
}

export interface AppConfig {
  provider: 'official' | 'relay' | 'custom';
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  imageModel: string;
}
