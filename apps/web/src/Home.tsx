import { useCallback, useMemo, useState } from 'react';
import { useQuery, useZero } from 'lib/client';
import { queries, mutators, LoroDoc, LoroMap, LoroMovableList, LoroText } from 'lib/shared';
import { Dialog } from '@base-ui/react/dialog';
import { Avatar } from '@base-ui/react/avatar';
import { Input } from '@base-ui/react/input';
import { useDocIdFromUrl } from './useDocIdFromUrl';
import { Editor } from './Editor';
import { DocumentListItem } from './DocumentListItem';

const HomePage = ({ onSignOut }: { onSignOut: () => void }) => {
  const zero = useZero();
  const [docs] = useQuery(queries.doc.all());
  const [me] = useQuery(queries.user.me());

  const [title, setTitle] = useState('');
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  }, []);
  const [selectedDocId, setSelectedDocId] = useDocIdFromUrl();

  const handleSelectDoc = useCallback(
    (docId: string) => {
      setSelectedDocId(docId);
    },
    [setSelectedDocId]
  );

  const handleDeleteDoc = useCallback(
    (docId: string) => {
      zero.mutate(mutators.doc.delete({ id: docId }));
    },
    [zero]
  );

  const onCreate = useCallback(() => {
    const loroDoc = new LoroDoc();
    const docRoot = loroDoc.getMap('docRoot');
    docRoot.set('type', 'doc');
    const docContent = docRoot.setContainer('content', new LoroMovableList());
    const paragraph = docContent.pushContainer(new LoroMap());
    paragraph.set('type', 'paragraph');
    paragraph.setContainer('content', new LoroText());
    const snapshot = loroDoc.export({ mode: 'snapshot' });

    zero.mutate(
      mutators.doc.create({
        id: crypto.randomUUID(),
        title,
        content: btoa(String.fromCharCode(...snapshot)),
      })
    );
  }, [title, zero]);

  const editorUser = useMemo(
    () => ({
      name: me?.name ?? 'test_user',
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
    }),
    [me]
  );

  const newDocDialog = useMemo(() => {
    return (
      <Dialog.Root>
        <Dialog.Trigger className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 bg-white hover:bg-slate-50 transition-colors duration-150 border border-slate-200 shadow-sm hover:shadow hover:border-slate-300">
          <svg
            className="w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Document
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0" />
          <Dialog.Viewport className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Popup className="w-full max-w-md bg-white rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-slate-200 transition-all duration-200 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0">
              <Dialog.Title className="text-lg font-semibold text-slate-900 mb-4">
                Create New Document
              </Dialog.Title>
              <Dialog.Description className="mb-6">
                <Input
                  placeholder="Enter document title..."
                  className="w-full h-11 px-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 focus:bg-white transition-all"
                  onChange={handleTitleChange}
                />
              </Dialog.Description>
              <div className="flex justify-end gap-3">
                <Dialog.Close className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  Cancel
                </Dialog.Close>
                <Dialog.Close
                  onClick={onCreate}
                  disabled={!title}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  Create
                </Dialog.Close>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }, [title, onCreate, handleTitleChange]);

  const selectedDoc = useMemo(
    () => docs?.find((d) => d.id === selectedDocId) ?? null,
    [docs, selectedDocId]
  );

  return (
    <div className="h-screen w-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 h-full flex flex-col bg-white border-r border-slate-200 shadow-sm">
        {/* Sidebar Header - User Avatar */}
        <div className="h-[72px] shrink-0 px-4 border-b border-slate-200 flex items-center">
          <div className="flex items-center gap-3">
            <Avatar.Root className="inline-flex size-10 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-teal-400 to-cyan-500 ring-2 ring-white shadow-md">
              <Avatar.Image
                src={me?.image ?? ''}
                width="40"
                height="40"
                className="size-full object-cover"
              />
              <Avatar.Fallback className="flex size-full items-center justify-center text-sm font-semibold text-white">
                {me?.name?.charAt(0)?.toUpperCase() ?? 'U'}
              </Avatar.Fallback>
            </Avatar.Root>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {me?.name ?? 'Guest User'}
              </p>
              <p className="text-xs text-slate-400 truncate">
                {me?.email
                  ? `${me.email[0]}${'*'.repeat(me.email.indexOf('@') - 1)}@${'*'.repeat(
                      me.email.length - me.email.indexOf('@') - 2
                    )}${me.email[me.email.length - 1]}`
                  : 'Not signed in'}
              </p>
            </div>
          </div>
        </div>

        {/* New Doc Button */}
        <div className="p-3">{newDocDialog}</div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
              Documents
            </p>
            <nav className="space-y-0.5">
              {docs && docs.length > 0 ? (
                docs.map((doc) => (
                  <DocumentListItem
                    key={doc.id}
                    doc={doc}
                    isSelected={selectedDocId === doc.id}
                    onSelect={handleSelectDoc}
                    onDelete={handleDeleteDoc}
                  />
                ))
              ) : (
                <div className="px-3 py-8 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 mb-3">
                    <svg
                      className="w-6 h-6 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-slate-500">No documents yet</p>
                  <p className="text-xs text-slate-400 mt-1">Create your first document</p>
                </div>
              )}
            </nav>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-400">
            <span>{docs?.length ?? 0} documents</span>
          </div>
          <button
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-600 bg-white hover:bg-slate-50 transition-colors duration-150 border border-slate-200 shadow-sm hover:shadow hover:border-slate-300"
          >
            <svg
              className="w-4 h-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-hidden bg-white">
        {selectedDoc ? (
          <div className="h-full flex flex-col">
            <header className="h-[72px] shrink-0 px-6 border-b border-slate-200 bg-white flex items-center">
              <h1 className="text-lg font-semibold text-slate-900">{selectedDoc.title}</h1>
            </header>
            <div className="flex-1 overflow-hidden">
              <Editor docId={selectedDoc.id} user={editorUser} />
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center bg-slate-50/30">
            <div className="text-center max-w-md px-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-linear-to-br from-slate-100 to-slate-50 border border-slate-200 shadow-sm mb-6">
                <svg
                  className="w-10 h-10 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Select a document</h2>
              <p className="text-sm text-slate-500">
                Choose a document from the sidebar to start editing, or create a new one.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default HomePage;
