import { useCallback, useState } from 'react';
import { buildSession } from './model/lines';
import type { DrillLine } from './model/lines';
import { bumpStreak } from './model/srs';
import type { PathStep } from './model/tree';
import { useAppState } from './useAppState';
import { CollectionView } from './ui/CollectionView';
import { Collections } from './ui/Collections';
import { applyGrade, Drill } from './ui/Drill';
import { Editor } from './ui/Editor';
import { Games } from './ui/Games';
import { GameView } from './ui/GameView';
import { RepertoireList } from './ui/RepertoireList';
import './App.css';

type View =
  | { name: 'list' }
  | { name: 'editor'; repertoireId: string; path?: PathStep[] }
  | { name: 'collections' }
  | { name: 'collection'; collectionId: string }
  | { name: 'game'; collectionId: string; gameId: string }
  | { name: 'review'; collectionId: string }
  | { name: 'drill'; lines: DrillLine[] };

/**
 * Four screens, no router. Deep links aren't wanted (a puzzle shouldn't be
 * resumable by URL), so a view union is enough and keeps Pages hosting simple.
 */
export default function App() {
  const { state, setState, updateRepertoire } = useAppState();
  const [view, setView] = useState<View>({ name: 'list' });

  const onChange = useCallback(
    (fn: Parameters<typeof updateRepertoire>[1]) => {
      if (view.name === 'editor') updateRepertoire(view.repertoireId, fn);
    },
    [updateRepertoire, view],
  );

  const onGrade = useCallback(
    (repertoireId: string, fen: string, correct: boolean) => {
      setState((s) =>
        s ? applyGrade(s, repertoireId, fen, correct, Date.now()) : s,
      );
    },
    [setState],
  );

  const startSession = useCallback(() => {
    if (!state) return;
    const lines = buildSession(state, Date.now());
    if (lines.length) setView({ name: 'drill', lines });
  }, [state]);

  const endSession = useCallback(() => {
    // The streak counts a day a session was run, whether or not the queue was
    // emptied — showing up is the habit being tracked.
    setState((s) => (s ? { ...s, streak: bumpStreak(s.streak, Date.now()) } : s));
    setView({ name: 'list' });
  }, [setState]);

  if (!state) {
    return (
      <main className="app">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (view.name === 'drill') {
    return (
      <main className="app">
        <Drill
          state={state}
          lines={view.lines}
          onGrade={onGrade}
          onDone={endSession}
        />
      </main>
    );
  }

  if (view.name === 'review') {
    const collection = state.collections.find(
      (c) => c.id === view.collectionId,
    );
    if (collection) {
      return (
        <main className="app">
          <Games
            state={state}
            setState={setState}
            collection={collection}
            onFix={(repertoireId, path) =>
              setView({ name: 'editor', repertoireId, path })
            }
            onBack={() =>
              setView({ name: 'collection', collectionId: collection.id })
            }
          />
        </main>
      );
    }
  }

  if (view.name === 'collections') {
    return (
      <main className="app">
        <Collections
          state={state}
          setState={setState}
          onOpen={(collectionId) => setView({ name: 'collection', collectionId })}
          onBack={() => setView({ name: 'list' })}
        />
      </main>
    );
  }

  if (view.name === 'collection') {
    const collection = state.collections.find(
      (c) => c.id === view.collectionId,
    );
    if (collection) {
      return (
        <main className="app">
          <CollectionView
            state={state}
            collection={collection}
            onOpenGame={(gameId) =>
              setView({ name: 'game', collectionId: collection.id, gameId })
            }
            onReview={(collectionId) => setView({ name: 'review', collectionId })}
            onBack={() => setView({ name: 'collections' })}
          />
        </main>
      );
    }
  }

  if (view.name === 'game') {
    const collection = state.collections.find(
      (c) => c.id === view.collectionId,
    );
    const game = collection?.games.find((g) => g.id === view.gameId);
    if (collection && game) {
      return (
        <main className="app">
          <GameView
            state={state}
            game={game}
            onAdopt={updateRepertoire}
            onBack={() =>
              setView({ name: 'collection', collectionId: collection.id })
            }
          />
        </main>
      );
    }
  }

  if (view.name === 'editor') {
    const rep = state.repertoires.find((r) => r.id === view.repertoireId);
    if (rep) {
      return (
        <main className="app">
          <Editor
            key={rep.id + (view.path?.length ?? 0)}
            rep={rep}
            initialPath={view.path}
            onChange={onChange}
            onBack={() => setView({ name: 'list' })}
          />
        </main>
      );
    }
  }

  return (
    <main className="app">
      <RepertoireList
        state={state}
        setState={setState}
        onOpen={(repertoireId) => setView({ name: 'editor', repertoireId })}
        onStartSession={startSession}
        onReviewGames={() => setView({ name: 'collections' })}
      />
    </main>
  );
}
