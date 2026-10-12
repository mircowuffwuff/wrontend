// the card that ends a turn which changed files: one row per file with its line counts, each expanding into its diffs

import { useState } from 'react';
import type { EditedFile } from '../state/transcript';
import { Counts, countContent, DiffView } from './Diff';
import { Icon } from './Icon';

// rows shown before Show more
const FIRST = 3;

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function FileRow({ file }: { file: EditedFile }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="edited-file">
      <button className="edited-row" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={file.path}>
        <Icon name="file" size={15} />
        <span className="name">{fileName(file.path)}</span>
        <Counts counts={countContent(file.diffs)} />
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {open && (
        <div className="edited-diffs">
          <div className="edited-path mono">{file.path}</div>
          {file.diffs.map((d, i) => (
            <DiffView key={i} oldText={d.oldText} newText={d.newText} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EditedFiles({ files }: { files: EditedFile[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, FIRST);
  const hidden = files.length - FIRST;
  return (
    <div className="edited-files">
      <div className="edited-head">
        <Icon name="changes" size={15} />
        <span className="name">Edited {files.length === 1 ? 'a file' : `${files.length} files`}</span>
        <Counts counts={countContent(files.flatMap((f) => f.diffs))} />
        {/* the rows' chevrons take this space, so every count lines up */}
        <span className="chevron-space" />
      </div>
      {shown.map((f) => (
        <FileRow key={f.path} file={f} />
      ))}
      {hidden > 0 && (
        <button className="edited-row more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          <span className="name">{all ? 'Show less' : `Show ${hidden} more`}</span>
          <Icon name={all ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
      )}
    </div>
  );
}
