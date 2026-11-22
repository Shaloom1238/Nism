import { Download, Plus, Search, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  DifficultyLevel,
  ExamDefinition,
  OptionKey,
  Question,
  QuestionType,
} from '../types/exam';
import { extractTextFromUploadedFile, parseChapterWiseMcqText } from '../utils/docQuestionParser';

interface QuestionBankViewProps {
  exam: ExamDefinition;
  questions: Question[];
  onImportQuestions: (newQuestions: Question[]) => Promise<void>;
}

const VALID_OPTIONS: OptionKey[] = ['A', 'B', 'C', 'D'];
const VALID_DIFFICULTIES: DifficultyLevel[] = ['Easy', 'Moderate', 'Difficult'];
const VALID_TYPES: QuestionType[] = [
  'Conceptual',
  'Definition',
  'Practical Application',
  'Scenario-based',
  'Numerical',
  'Case Study',
  'Regulatory & Compliance',
  'Exceptions & Conditions',
];

export function QuestionBankView({
  exam,
  questions,
  onImportQuestions,
}: QuestionBankViewProps) {
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'text' | 'json'>('text');
  const [defaultChapter, setDefaultChapter] = useState<number>(1);
  const [importText, setImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const filteredQuestions = useMemo(() => {
    const qLower = searchQuery.trim().toLowerCase();
    return questions.filter((q) => {
      if (chapterFilter !== 'all' && q.chapterNumber !== Number(chapterFilter)) return false;
      if (difficultyFilter !== 'all' && q.difficulty !== difficultyFilter) return false;
      if (
        qLower &&
        !q.questionText.toLowerCase().includes(qLower) &&
        !q.topic.toLowerCase().includes(qLower) &&
        !q.id.toLowerCase().includes(qLower)
      ) {
        return false;
      }
      return true;
    });
  }, [questions, chapterFilter, difficultyFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredQuestions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedQuestions = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredQuestions.slice(start, start + PAGE_SIZE);
  }, [filteredQuestions, safePage]);

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exam.id}-question-bank.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = async () => {
    setImportFeedback(null);
    try {
      if (importMode === 'text') {
        const { questions: parsedQs, warnings } = parseChapterWiseMcqText(
          importText,
          exam,
          defaultChapter
        );
        if (parsedQs.length === 0) {
          setImportFeedback({
            type: 'error',
            message:
              'No complete MCQs detected. Ensure each question has numbered text, options A–D, and an Answer line (e.g., "Answer: B").',
          });
          return;
        }
        await onImportQuestions(parsedQs);
        setImportFeedback({
          type: 'success',
          message: `Extracted and saved ${parsedQs.length} MCQ(s) into memory for ${exam.code}.${
            warnings.length > 0 ? ` (${warnings.length} incomplete item(s) skipped)` : ''
          }`,
        });
        setImportText('');
        return;
      }

      const parsed = JSON.parse(importText);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0) {
        setImportFeedback({ type: 'error', message: 'Provide at least one question object.' });
        return;
      }

      const validated: Question[] = [];
      for (let i = 0; i < arr.length; i++) {
        const raw = arr[i];
        const chNum = Number(raw.chapterNumber);
        const chapterObj = exam.chapters.find((c) => c.chapterNumber === chNum);
        if (!chapterObj) {
          throw new Error(
            `Item ${i + 1}: chapterNumber "${raw.chapterNumber}" does not exist in ${exam.code}.`
          );
        }
        if (
          !raw.questionText ||
          !raw.options?.A ||
          !raw.options?.B ||
          !raw.options?.C ||
          !raw.options?.D ||
          !VALID_OPTIONS.includes(raw.correctAnswer) ||
          !raw.explanation
        ) {
          throw new Error(
            `Item ${i + 1}: Missing required fields (questionText, options A–D, correctAnswer, explanation).`
          );
        }

        validated.push({
          id: raw.id ? String(raw.id) : `${exam.id.toUpperCase()}-IMP-${Date.now()}-${i}`,
          examId: exam.id,
          examName: exam.name,
          chapterNumber: chNum,
          chapterTitle: chapterObj.title,
          topic: raw.topic ? String(raw.topic) : 'General Concept',
          questionText: String(raw.questionText),
          options: {
            A: String(raw.options.A),
            B: String(raw.options.B),
            C: String(raw.options.C),
            D: String(raw.options.D),
          },
          correctAnswer: raw.correctAnswer,
          explanation: String(raw.explanation),
          difficulty: VALID_DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : 'Moderate',
          questionType: VALID_TYPES.includes(raw.questionType) ? raw.questionType : 'Conceptual',
        });
      }

      await onImportQuestions(validated);
      setImportFeedback({
        type: 'success',
        message: `Successfully imported ${validated.length} question(s) into IndexedDB.`,
      });
      setImportText('');
    } catch (err) {
      setImportFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid input format.',
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFeedback(null);

    if (file.name.toLowerCase().endsWith('.json')) {
      setImportMode('json');
      const text = await file.text();
      setImportText(text);
    } else {
      setImportMode('text');
      const extracted = await extractTextFromUploadedFile(file);
      setImportText(extracted);
    }
  };

  const sampleTextTemplate = `Chapter 1: Investment Landscape
1. Which of the following best describes real rate of return?
A. Nominal return plus inflation
B. Nominal return adjusted for inflation
C. Pre-tax return before compounding
D. Dividend yield divided by NAV
Answer: B
Explanation: Real rate of return adjusts nominal returns for purchasing power erosion caused by inflation.`;

  const sampleJsonTemplate = JSON.stringify(
    [
      {
        chapterNumber: 1,
        topic: 'Asset Allocation',
        questionText: 'Sample custom question text here?',
        options: {
          A: 'Option A text',
          B: 'Option B text',
          C: 'Option C text',
          D: 'Option D text',
        },
        correctAnswer: 'B',
        explanation: 'Concise educational explanation for Option B.',
        difficulty: 'Moderate',
        questionType: 'Conceptual',
      },
    ],
    null,
    2
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end dark:border-slate-800">
        <div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
            {exam.code} · Structured Repository
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            Question Bank ({questions.length} MCQs)
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
            Browse Series V-A questions chapter-wise, export backups, or import chapter-wise MCQs from Word/text/JSON into memory.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export JSON</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setImportFeedback(null);
              setShowImportModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Import from .doc / Text / JSON</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by topic, text, or ID..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <select
          value={chapterFilter}
          onChange={(e) => {
            setChapterFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by chapter"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="all">All Chapters ({exam.chapters.length})</option>
          {exam.chapters.map((c) => (
            <option key={c.chapterNumber} value={String(c.chapterNumber)}>
              Ch. {c.chapterNumber}: {c.title}
            </option>
          ))}
        </select>

        <select
          value={difficultyFilter}
          onChange={(e) => {
            setDifficultyFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by difficulty"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="all">All Difficulties</option>
          {VALID_DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
        <span>
          Showing {filteredQuestions.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–
          {Math.min(safePage * PAGE_SIZE, filteredQuestions.length)} of {filteredQuestions.length} matching questions ({questions.length} total)
        </span>
        {totalPages > 1 && (
          <span>
            Page {safePage} of {totalPages}
          </span>
        )}
      </div>

      {/* Questions List */}
      <div className="mt-4 space-y-4">
        {paginatedQuestions.map((q) => (
          <details
            key={q.id}
            className="group rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-tabular font-semibold text-blue-700 dark:text-blue-400">
                    {q.id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Ch. {q.chapterNumber}: {q.chapterTitle}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{q.topic}</span>
                </div>
                <div className="flex items-center gap-2 font-mono-tabular">
                  <span>{q.questionType}</span>
                  <span aria-hidden="true">·</span>
                  <span>{q.difficulty}</span>
                </div>
              </div>
              <p className="mt-2 font-display text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
                {q.questionText}
              </p>
            </summary>

            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {VALID_OPTIONS.map((k) => {
                  const isCorrect = q.correctAnswer === k;
                  return (
                    <div
                      key={k}
                      className={`rounded-lg border px-3 py-2 text-xs sm:text-sm ${
                        isCorrect
                          ? 'border-emerald-400 bg-emerald-50/70 font-medium text-slate-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-slate-100'
                          : 'border-slate-200 bg-slate-50/60 text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300'
                      }`}
                    >
                      <span className="font-mono-tabular font-bold">{k}.</span> {q.options[k]}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                <strong className="text-slate-900 dark:text-slate-100">Explanation:</strong>{' '}
                {q.explanation}
              </p>
            </div>
          </details>
        ))}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Previous Page
          </button>
          <span className="font-mono-tabular text-xs font-medium text-slate-600 dark:text-slate-300">
            Page {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Next Page
          </button>
        </div>
      )}

      {/* Import Questions Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="import-modal-title"
                className="font-display text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                Import MCQs for {exam.code}
              </h2>

              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setImportMode('text')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${
                    importMode === 'text'
                      ? 'bg-white text-blue-700 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Word / .doc / Text
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('json')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${
                    importMode === 'json'
                      ? 'bg-white text-blue-700 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  JSON
                </button>
              </div>
            </div>

            <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
              {importMode === 'text'
                ? 'Upload a .doc or .txt file, or copy-paste chapter-wise MCQs directly from Microsoft Word. Chapter headings (e.g., "Chapter 3") automatically assign questions to each chapter.'
                : 'Paste a JSON array or upload a .json file of structured questions to store permanently in IndexedDB.'}
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Load .doc / .txt / .json</span>
                  <input
                    type="file"
                    accept=".doc,.txt,.json,application/msword,text/plain,application/json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {importMode === 'text' && (
                  <select
                    value={defaultChapter}
                    onChange={(e) => setDefaultChapter(Number(e.target.value))}
                    aria-label="Fallback Chapter"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {exam.chapters.map((c) => (
                      <option key={c.chapterNumber} value={c.chapterNumber}>
                        Default: Ch. {c.chapterNumber}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  setImportText(importMode === 'text' ? sampleTextTemplate : sampleJsonTemplate)
                }
                className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
              >
                Insert Sample Format
              </button>
            </div>

            <textarea
              rows={9}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                importMode === 'text'
                  ? 'Paste chapter-wise MCQs from your Word document...'
                  : 'Paste JSON array of questions...'
              }
              className="mt-3 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />

            {importFeedback && (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
                  importFeedback.type === 'success'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                }`}
              >
                {importFeedback.message}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!importText.trim()}
                onClick={handleImportSubmit}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 dark:bg-blue-600"
              >
                Extract &amp; Save to Bank
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
