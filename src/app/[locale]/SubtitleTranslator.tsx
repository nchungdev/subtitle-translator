"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Flex, Card, Button, Typography, Input, Upload, Form, Space, App, Tooltip, Segmented, Spin, Row, Col, Divider, Collapse, Alert, theme, Progress, Tag, Tabs, Switch, Select, AutoComplete, Checkbox, Popconfirm } from "antd";
import {
  SettingOutlined,
  CopyOutlined,
  InboxOutlined,
  FileTextOutlined,
  FormatPainterOutlined,
  GlobalOutlined,
  ImportOutlined,
  SaveOutlined,
  ControlOutlined,
  ScissorOutlined,
  BranchesOutlined,
  FolderOpenOutlined,
  CloseOutlined,
  DownOutlined,
  UpOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  ShareAltOutlined,
  BookOutlined,
  ApiOutlined,
  FileZipOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  SearchOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import SubtitleReviewTab from "@/app/components/SubtitleReviewTab";
import { useTranslations } from "next-intl";
import JSZip from "jszip";
import CharacterGraphModal from "@/app/components/CharacterGraphModal";
import { MovieContextBuilder } from "@/app/components/MovieContextBuilder";
import { useCopyToClipboard } from "@/app/hooks/useCopyToClipboard";
import useFileUpload from "@/app/hooks/useFileUpload";
import { useResetOnSourceChange } from "@/app/hooks/useResetOnSourceChange";
import { useLocalStorage } from "@/app/hooks/useLocalStorage";
import { useTextStats } from "@/app/hooks/useTextStats";
import { useExportFilename } from "@/app/hooks/useExportFilename";
import { computeFileMd5, getCachedFileByMd5, saveFileToDiskCache, deleteDiskCacheItem, clearAllDiskCache } from "@/app/lib/storage/fileDiskCache";
import { translationCache } from "@/app/lib/storage/indexedDBStorage";

import { splitTextIntoLines, downloadFile, applyRemoveCharsToLines, describeError, isAbortError, isCascadedAbort, isNetworkError, getFileTypePresetConfig } from "@/app/utils";
import {
  detectSubtitleFormat,
  getOutputFileExtension,
  filterSubLines,
  ASS_STYLE_PRESETS,
  prepareAssForTranslation,
  restoreAssAfterTranslation,
  applyRemoveCharsToAssLines,
  appendBilingualSuffix,
  assembleSubtitleOutput,
  SUBTITLE_DEFAULTS,
  parseAssDialogueStyles,
  detectAssLanguageGroups,
  type BilingualFormat,
  type AssStyleConfig,
  type AssStylePreset,
} from "@/app/lib/translation/formats/subtitle";
import { LLM_MODELS, categorizedOptions, findMethodLabel, getProviderModels } from "@/app/lib/translation";
import { transformSkippingSoftFilled } from "@/app/lib/translation/softFill";
import { delay } from "@/app/lib/translation/retry";
import BilingualTranslateModal, { type BackgroundTaskPayload } from "@/app/components/BilingualTranslateModal";
import { useLanguageOptions } from "@/app/components/languages";
import LanguageSelector from "@/app/components/LanguageSelector";
import ApiStatusBlock from "@/app/components/ApiStatusBlock";
import ContextTranslationBlock from "@/app/components/ContextTranslationBlock";
import TranslationProgressStrip from "@/app/components/TranslationProgressStrip";
import LiveTranslationResults from "./LiveTranslationResults";
import { useTranslationContext } from "@/app/components/TranslationContext";
import ResultCard from "@/app/components/ResultCard";
import BilingualReviewPanel from "./BilingualReviewPanel";
import AdvancedTranslationSettings from "@/app/components/AdvancedTranslationSettings";
import TranslateFailurePanel from "@/app/components/TranslateFailurePanel";

import MultiLanguageSettingsModal from "@/app/components/MultiLanguageSettingsModal";
import SplitBilingualModal from "@/app/components/SplitBilingualModal";
import SourceArea from "@/app/components/SourceArea";

const { Text } = Typography;

const BackgroundBatchProgressStrip = ({
  task,
  onOpenModal,
  onDismiss,
}: {
  task: BackgroundTaskPayload;
  onOpenModal: () => void;
  onDismiss: () => void;
}) => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  const t = useTranslations("common");
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);

  const total = task.items.length;
  const doneItems = task.items.filter((it) => it.status === "done");
  const errorItems = task.items.filter((it) => it.status === "error");
  const completedCount = doneItems.length + errorItems.length;
  const percent = total > 0 ? Math.floor((completedCount / total) * 100) : 0;
  const isDone = !task.isProcessing;

  const title =
    task.type === "bilingual"
      ? isDone
        ? tSubtitle("bilingualTranslateDone", { count: doneItems.length })
        : tSubtitle("bilingualTranslatingProgress", { current: completedCount, total })
      : isDone
      ? tSubtitle("splitDone", { count: doneItems.length })
      : tSubtitle("splitProgress", { current: completedCount, total });

  const marker = isDone ? "DONE" : "IN PROGRESS";
  const monoCaps: React.CSSProperties = { fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase" };

  const handleDownloadAllCompleted = async () => {
    if (doneItems.length === 0) return;
    if (doneItems.length === 1 && doneItems[0].content) {
      downloadFile(doneItems[0].content, doneItems[0].fileName);
      return;
    }
    const zip = new JSZip();
    for (const item of doneItems) {
      if (item.content) {
        zip.file(item.fileName, item.content);
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = task.zipFileName || "translated_subtitles.zip";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="status"
      style={{
        border: `1px solid ${isDone ? token.colorSuccessBorder : token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
        padding: "12px 14px",
        marginTop: 12,
      }}>
      <div className="font-mono flex items-center justify-between" style={{ ...monoCaps, color: token.colorTextTertiary, marginBottom: 10 }}>
        <span className="flex items-center" style={{ gap: 7 }}>
          <span style={{ width: 7, height: 7, background: isDone ? token.colorSuccess : token.colorPrimary, display: "inline-block" }} />
          {marker}
          <span className="font-display" style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0, textTransform: "none", color: isDone ? token.colorSuccess : token.colorText }}>
            {percent}%
          </span>
        </span>
        <span>
          <span style={{ color: token.colorText }}>{completedCount}</span>
          <span style={{ opacity: 0.5 }}> / {total}</span>
        </span>
      </div>

      <Progress
        percent={percent}
        status={isDone ? "success" : "active"}
        showInfo={false}
        strokeLinecap="butt"
        size={{ height: 6 }}
        style={{ marginBottom: 10, lineHeight: 1 }}
      />

      <div className="flex items-center justify-between" style={{ gap: 12 }}>
        <Text strong style={{ fontSize: 13, flex: 1, minWidth: 0 }} ellipsis>
          {title}
        </Text>
        <Space size="small">
          <Button
            size="small"
            type="text"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? t.has("hideResults") ? t("hideResults") : "Thu gọn"
              : t.has("showResults") ? t("showResults") : "Hiện chi tiết"}
          </Button>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={onOpenModal}>
            {tSubtitle("viewResults")}
          </Button>
          {task.isProcessing ? (
            <Button size="small" onClick={task.onCancel}>
              {t("cancel")}
            </Button>
          ) : (
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={onDismiss} aria-label={t("dismiss")} />
          )}
        </Space>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}`, maxHeight: 220, overflowY: "auto" }}>
          <Flex vertical gap={6}>
            {task.items.map((item) => (
              <Flex key={item.key} justify="space-between" align="center" style={{ fontSize: 12, padding: "6px 10px", background: token.colorFillAlter, borderRadius: token.borderRadiusSM }}>
                <Space size="small" style={{ minWidth: 0, flex: 1 }}>
                  {item.status === "done" && <CheckCircleOutlined style={{ color: token.colorSuccess }} />}
                  {item.status === "processing" && (
                    <Space size={4}>
                      <Spin size="small" />
                      {item.step && (
                        <Tag color="processing" style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                          Bước {item.step.current}/{item.step.total}
                        </Tag>
                      )}
                    </Space>
                  )}
                  {item.status === "error" && <CloseCircleOutlined style={{ color: token.colorError }} />}
                  {item.status === "pending" && <ClockCircleOutlined style={{ color: token.colorTextTertiary }} />}
                  <Text ellipsis style={{ fontSize: 12, maxWidth: 260 }}>{item.fileName}</Text>
                  {item.progressLabel && <Text type="secondary" style={{ fontSize: 11 }}>({item.progressLabel})</Text>}
                </Space>
                {item.status === "done" && item.content && (
                  <Button
                    size="small"
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadFile(item.content!, item.fileName)}
                  >
                    {t("download")}
                  </Button>
                )}
                {item.status === "error" && (
                  <Text type="danger" style={{ fontSize: 11 }}>{item.errorMessage || t("failed")}</Text>
                )}
              </Flex>
            ))}
          </Flex>
        </div>
      )}
    </div>
  );
};

import dynamic from "next/dynamic";
const AssStyleDrawer = dynamic(() => import("./AssStyleDrawer"), { ssr: false });

const { TextArea } = Input;
const { Dragger } = Upload;

const uploadFileTypes = getFileTypePresetConfig("subtitle");

const SubtitleTranslator = () => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  const t = useTranslations("common");

  const { sourceOptions } = useLanguageOptions();
  const { copyToClipboard } = useCopyToClipboard();
  // ... useFileUpload destructuring ...
  const {
    isFileProcessing,
    fileList,
    multipleFiles,
    readFile,
    sourceText,
    setSourceText,
    uploadMode,
    singleFileMode,
    setSingleFileMode,
    handleFileUpload,
    handleUploadRemove,
    handleUploadChange,
    resetUpload,
  } = useFileUpload();
  // ... useTranslationContext destructuring ...
  const {
    exportSettings,
    importSettings,
    setApiSettingsOpen,
    translationMethod,
    translateBatch,
    runTranslation,
    sourceLanguage,
    targetLanguage,
    targetLanguages,
    setTargetLanguages,
    useCache,
    setUseCache,
    skipCachedFiles,
    setSkipCachedFiles,
    characterGraphEnabled,
    setCharacterGraphEnabled,
    characterGraphProvider,
    setCharacterGraphProvider,
    getCharacterGraphConfig,
    updateCharacterGraphConfig,
    translationPhase,
    getSelectedConfig,
    removeChars,
    setRemoveChars,
    multiLanguageMode,
    setMultiLanguageMode,
    translatedText,
    setTranslatedText,
    failedCount,
    failedLines,
    failedLangs,
    setFailedLangs,
    failedReason,
    clearFailures,
    markRunHadFailures,
    hadRunFailures,
    runHadFailures,
    runRetry,
    isScopedRetry,
    getActiveTargetLangs,
    isDisposed,
    isTranslating,
    setIsTranslating,
    resetProgress,
    liveLinesStore,
    clearLiveLines,
    recordLiveLine,
    progressPercent,
    setProgressPercent,
    progressInfo,
    handleLanguageChange,
    handleSwapLanguages,
    validate,
    requestCancel,
    isCancelRequested,
    retryCount,
    setRetryCount,
    requestTimeoutSec,
    setRequestTimeoutSec,
  } = useTranslationContext();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const cardStyle: React.CSSProperties = { boxShadow: token.boxShadowTertiary };
  const activeGraphConfig = getCharacterGraphConfig(characterGraphProvider);

  const sourceStats = useTextStats(sourceText);
  const resultStats = useTextStats(translatedText);

  // Main UI Tab: 'context' | 'translate'
  const [mainTabKey, setMainTabKey] = useState<string>("translate");

  // Export mode: 'translatedOnly' | 'bilingual' | 'both'
  const [exportMode, setExportMode] = useLocalStorage<"translatedOnly" | "bilingual" | "both">("subtitle-translator-exportMode", "translatedOnly");
  // bilingualOrder 标识双语拼接顺序:谁先呈现(SRT/VTT/ASS 多行 = 在上;LRC 行内 = 在前)
  // 默认译文在上:符合中外双语惯例(译文为主、较大、在上;原文较小在下)。
  type BilingualOrder = "originalFirst" | "translationFirst";
  const [bilingualOrder, setBilingualOrder] = useLocalStorage<BilingualOrder>("subtitle-translator-bilingualOrder", "translationFirst");
  const isOriginalFirst = bilingualOrder === "originalFirst";
  // SRT/VTT 双语输出格式选择,ASS=转换为 ASS(默认,保留旧行为),SRT=保留源格式叠两行
  // ASS/LRC 源文件忽略此选项(它们各自有专用的双语格式)
  const [bilingualFormat, setBilingualFormat] = useLocalStorage<BilingualFormat>("subtitle-translator-bilingualFormat", "ass");
  // key 带 -v2:结构从位置(top/bottom)改为角色(translation/original),旧存值形状不兼容,
  // 直接换 key 让旧值过期、回落到新默认(不写迁移垫片,符合项目"旧版过期"约定)。
  const [assStyle, setAssStyle] = useLocalStorage<AssStyleConfig>("subtitle-translator-assStyle-v2", ASS_STYLE_PRESETS.default);
  const [assPreset, setAssPreset] = useLocalStorage<AssStylePreset | "custom">("subtitle-translator-assPreset", "default");
  // 自定义配置单独存:切到预设再切回「自定义」时恢复,避免一切换自定义就丢。
  const [assCustomStyle, setAssCustomStyle] = useLocalStorage<AssStyleConfig>("subtitle-translator-assCustomStyle", ASS_STYLE_PRESETS.default);
  // 单一入口:同步 config + preset;preset 为 custom 时把配置落进 customStyle。
  const handleAssChange = (cfg: AssStyleConfig, p: AssStylePreset | "custom") => {
    setAssStyle(cfg);
    setAssPreset(p);
    if (p === "custom") setAssCustomStyle(cfg);
  };
  // 原生 ASS 双语:false=逐行沿用源样式(默认);true=放弃源样式、用本工具预设重新排版。
  const [assNativeRebuild, setAssNativeRebuild] = useLocalStorage<boolean>("subtitle-translator-assNativeRebuild", false);

  // 双语模式标志:exportMode 是 "bilingual" 或 "both" 时需要生成双语版本
  const needsBilingual = exportMode === "bilingual" || exportMode === "both";

  // 源格式检测:单文件看 sourceText,多文件用第一个文件的扩展名作代表
  // deps 只列实际读取的字段(firstFileName),避免整个 multipleFiles 数组引用变化触发重算
  const firstFileName = multipleFiles[0]?.name;
  const sourceFileType = useMemo<"ass" | "vtt" | "srt" | "lrc" | "sbv" | "error" | null>(() => {
    if (sourceText.trim()) {
      return detectSubtitleFormat(splitTextIntoLines(sourceText));
    }
    if (!firstFileName) return null;
    const ext = firstFileName.split(".").pop()?.toLowerCase();
    if (ext === "ass" || ext === "vtt" || ext === "srt" || ext === "lrc" || ext === "sbv") return ext;
    // SSA(v4.00)与 ASS 共用同一条管线,内部 fileType 统一为 "ass"
    if (ext === "ssa") return "ass";
    return null;
  }, [sourceText, firstFileName]);

  // ASS/SRT 格式选项只在 SRT/VTT 源 + 双语时显示——ASS/LRC 源选项无法兑现,避免 UI 撒谎
  const showBilingualFormatChoice = needsBilingual && (sourceFileType === "srt" || sourceFileType === "vtt");
  // 原生 ASS 双语:显示「沿用源样式 / 重新排版」选择;选重新排版才用本工具样式。
  const nativeAss = sourceFileType === "ass";
  const showNativeRebuildChoice = needsBilingual && nativeAss;
  // 「ASS 样式」可调:SRT/VTT 转 ASS,或 原生 ASS + 重新排版。
  const showAssStyle = (showBilingualFormatChoice && bilingualFormat === "ass") || (showNativeRebuildChoice && assNativeRebuild);
  const [collapseInputList, setCollapseInputList] = useLocalStorage<boolean>("subtitle-translator-collapseInputList", false);
  const [contextAware, setContextAware] = useLocalStorage("subtitle-translator-contextAware", SUBTITLE_DEFAULTS.contextAware); // 上下文感知翻译开关,默认值与 CLI 共用
  // 面板 key 必须与下方 Collapse items 的 key("subtitle"/"advanced")一致 ——
  // 旧默认值 "SubtitleTranslator" 不匹配任何面板,导出控件永远默认收起。
  const [collapseKeys, setCollapseKeys] = useLocalStorage<string[]>("subtitle-translator-collapseKeys", ["subtitle"]);
  const [multiLangModalOpen, setMultiLangModalOpen] = useState(false);
  const [assStyleOpen, setAssStyleOpen] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [bilingualTranslateModalOpen, setBilingualTranslateModalOpen] = useState(false);
  const [characterGraphModalOpen, setCharacterGraphModalOpen] = useState(false);
  const [bilingualTask, setBilingualTask] = useState<BackgroundTaskPayload | null>(null);
  const [splitTask, setSplitTask] = useState<BackgroundTaskPayload | null>(null);
  const [isContextProcessing, setIsContextProcessing] = useState(false);

  const isAnyApiRunning = isTranslating || isFileProcessing || isContextProcessing || !!bilingualTask?.isProcessing || !!splitTask?.isProcessing;
  // 提取出的纯文本预览 — 只在 SubtitleTranslator 和 MDTranslator 用,
  // 不应该污染 TranslationProvider 的共享 state。
  const [extractedText, setExtractedText] = useState("");
  // 批量翻译时统计失败文件数;handleMultipleTranslate 开始时重置,结束时读取以决定汇总消息。
  // 单文件模式(runTranslation 路径)下也会被写,但不会被读,无副作用。
  const failedFilesRef = useRef(0);
  // 【记一次文件级失败,只走这一个入口】。此前是两套并行记账:failedFilesRef
  // 只喂末尾的汇总 toast,markRunHadFailures 才是进度条能看见的信号 —— 结果
  // 批量里第一个文件格式不支持时只 bump 了 ref,进度条照样打绿色「翻译完成
  // 100%」,正压在「已导出 (4/5)」上面。合成一个函数,漏不掉。
  const noteFileFailure = () => {
    failedFilesRef.current++;
    markRunHadFailures();
  };
  // 记录最近一次写入 translatedText 时使用的扩展名,导出按钮按它生成文件名;
  // 避免用户翻译后改 exportMode/bilingualFormat,再点导出时扩展名跟内容错位
  const [translatedTextExt, setTranslatedTextExt] = useState<string | null>(null);
  // 标记 translatedText 是否是 exportMode="both" 的 bilingual 版本(需要 _bilingual 后缀);
  // both 模式下同时下载两份文件,如果两份 ext 相同(LRC/ASS/SRT+format=srt)文件名会冲突
  const [needsBilingualSuffix, setNeedsBilingualSuffix] = useState(false);
  // 记录 translatedText 是否含原文(双语产物)。校对面板不能只看【当前】
  // exportMode:双语翻译后把开关切回 translatedOnly,旧的双语产物仍在
  // translatedText 里(改设置不清结果,见上),按 index 与源配对必错位
  // (format=ass 时是 2N 条 Dialogue)。
  const [translatedTextBilingual, setTranslatedTextBilingual] = useState(false);
  // 记录 translatedText 对应的目标语种,handleExportFile 用它生成文件名;
  // 多语言模式下 translatedText 是 previewLang(常规跑 = targetLangs[0];scoped
  // 重试时保持上一次预览的语种)而非主 targetLanguage,不记录的话导出文件名会
  // 标错语种(主 targetLanguage 跟 translatedText 内容不匹配)
  const [translatedTextLang, setTranslatedTextLang] = useState<string | null>(null);
  const { customFileName, setCustomFileName, generateFileName } = useExportFilename("subtitle-translator");

  // Output items state for per-file results & bulk ZIP download
  const [translationOutputs, setTranslationOutputs] = useState<Array<{ key: string; fileName: string; status: "done" | "error"; content?: string; errorMessage?: string }>>([]);

  // Per-file Queue state & row controls
  interface FileQueueItem {
    id: string;
    file: File;
    fileName: string;
    fileSize: number;
    inputMd5?: string;
    cachedFileName?: string;
    status: "pending" | "translating" | "done" | "error";
    progressPercent: number;
    errorMessage?: string;
  }

  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);

  // Selection state for per-row checkboxes
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // Auto-sync selectedFileIds when fileQueue changes
  useEffect(() => {
    if (fileQueue.length > 0) {
      setSelectedFileIds(new Set(fileQueue.map((f) => f.id)));
    } else {
      setSelectedFileIds(new Set());
    }
  }, [fileQueue.length]);

  const isAllSelected = fileQueue.length > 0 && selectedFileIds.size === fileQueue.length;
  const isIndeterminate = selectedFileIds.size > 0 && selectedFileIds.size < fileQueue.length;

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFileIds(new Set(fileQueue.map((f) => f.id)));
    } else {
      setSelectedFileIds(new Set());
    }
  };

  const handleToggleSelectRow = (id: string, checked: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Compute pending selected count (excludes done files when skipCachedFiles is checked)
  const pendingSelectedItems = useMemo(() => {
    return fileQueue.filter((item) => {
      if (!selectedFileIds.has(item.id)) return false;
      if (skipCachedFiles && item.status === "done") return false;
      return true;
    });
  }, [fileQueue, selectedFileIds, skipCachedFiles]);

  const pendingSelectedCount = pendingSelectedItems.length;

  // Helper to handle downloading selected files (single direct download or bulk ZIP)
  const handleDownloadSelectedOrAll = async () => {
    const selectedQueueItems = fileQueue.filter((f) => selectedFileIds.has(f.id));
    const activeLang = targetLanguages[0] || "vi";

    const completedItems: Array<{ fileName: string; content: string }> = [];

    for (const item of selectedQueueItems) {
      // 1. Try finding in translationOutputs state
      const out = translationOutputs.find((o) => o.fileName.includes(item.fileName) || item.fileName.includes(o.fileName));
      if (out && out.content) {
        completedItems.push({ fileName: out.fileName, content: out.content });
        continue;
      }

      // 2. Try fetching from Disk Cache (IndexedDB) by inputMd5
      if (item.inputMd5) {
        const cached = await getCachedFileByMd5(item.inputMd5, activeLang);
        if (cached && cached.content) {
          completedItems.push({ fileName: cached.cachedFileName, content: cached.content });
        }
      }
    }

    if (completedItems.length === 0) {
      message.warning("Chưa có tệp nào được chọn đã hoàn thành dịch.");
      return;
    }

    if (completedItems.length === 1) {
      void downloadFile(completedItems[0].content, completedItems[0].fileName);
      message.success(`Đã tải xuống tệp: ${completedItems[0].fileName}`);
      return;
    }

    try {
      const zip = new JSZip();
      for (const item of completedItems) {
        zip.file(item.fileName, item.content);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      await downloadFile(blob, "subtitles_translated.zip");
      message.success(`Đã nén & tải xuống ${completedItems.length} tệp phụ đề (.zip) thành công!`);
    } catch (err) {
      message.error("Lỗi khi tải hàng loạt (.zip): " + describeError(err, t));
    }
  };

  // Remove a single file from queue and file list
  const removeSingleFileFromQueue = (targetId: string) => {
    const item = fileQueue.find((f) => f.id === targetId);
    if (!item) return;

    setFileQueue((prev) => prev.filter((f) => f.id !== targetId));
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(targetId);
      return next;
    });
    setTranslationOutputs((prev) => prev.filter((o) => !o.fileName.includes(item.fileName)));
    handleUploadRemove({ uid: targetId, name: item.fileName, size: item.fileSize } as any);
  };

  // Sync fileQueue with MD5 calculation & Disk Cache lookup (24h TTL, 1000 files cap)
  useEffect(() => {
    let cancelled = false;
    if (multipleFiles.length > 0) {
      const activeLang = targetLanguages[0] || "vi";

      // Immediate basic sync
      setFileQueue((prev) => {
        return multipleFiles.map((file) => {
          const id = file.name + "::" + file.size;
          const existing = prev.find((p) => p.id === id);
          if (existing) return existing;
          return {
            id,
            file,
            fileName: file.name,
            fileSize: file.size,
            status: "pending" as const,
            progressPercent: 0,
          };
        });
      });

      // Async MD5 calculation & Disk Cache lookup for each file
      for (const file of multipleFiles) {
        const id = file.name + "::" + file.size;
        readFile(file, async (text) => {
          if (cancelled || !text) return;
          const md5 = computeFileMd5(text);
          const cached = await getCachedFileByMd5(md5, activeLang);

          if (cached) {
            setFileQueue((prev) =>
              prev.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      inputMd5: md5,
                      cachedFileName: cached.cachedFileName,
                      status: "done" as const,
                      progressPercent: 100,
                    }
                  : item
              )
            );

            // Populate translationOutputs so download & ZIP work
            setTranslationOutputs((prev) => {
              if (prev.some((p) => p.fileName === cached.cachedFileName || p.fileName.includes(file.name))) {
                return prev;
              }
              return [
                ...prev,
                {
                  key: cached.cachedFileName,
                  fileName: cached.cachedFileName,
                  status: "done" as const,
                  content: cached.content,
                },
              ];
            });

            // Auto-check skipCachedFiles option!
            setSkipCachedFiles(true);
          } else {
            setFileQueue((prev) =>
              prev.map((item) => (item.id === id ? { ...item, inputMd5: md5 } : item))
            );
          }
        });
      }
    } else {
      setFileQueue([]);
      setSkipCachedFiles(false);
    }

    return () => {
      cancelled = true;
    };
  }, [multipleFiles, targetLanguages, setSkipCachedFiles]);

  // Translate a single queue item
  const translateSingleQueueItem = async (targetId: string) => {
    const targetItem = fileQueue.find((f) => f.id === targetId);
    if (!targetItem) return;

    setFileQueue((prev) =>
      prev.map((item) =>
        item.id === targetId ? { ...item, status: "translating", progressPercent: 0, errorMessage: undefined } : item
      )
    );

    try {
      const text = await new Promise<string>((resolve, reject) => {
        readFile(
          targetItem.file,
          (t) => resolve(t),
          () => reject(new Error("Không thể đọc file"))
        );
      });

      await performTranslation(text, targetItem.fileName, 0, 1);

      setFileQueue((prev) =>
        prev.map((item) =>
          item.id === targetId ? { ...item, status: "done", progressPercent: 100 } : item
        )
      );
    } catch (err: any) {
      if (err.name === "AbortError" || isAbortError(err)) {
        setFileQueue((prev) =>
          prev.map((item) =>
            item.id === targetId ? { ...item, status: "pending", progressPercent: 0 } : item
          )
        );
        message.info(`Đã hủy dịch: ${targetItem.fileName}`);
      } else {
        setFileQueue((prev) =>
          prev.map((item) =>
            item.id === targetId ? { ...item, status: "error", errorMessage: describeError(err, t) } : item
          )
        );
        message.error(`Lỗi dịch (${targetItem.fileName}): ${describeError(err, t)}`);
      }
    }
  };

  // Translate all items in queue (skips done files if skipCachedFiles is enabled)
  const handleTranslateAllQueue = async () => {
    if (fileQueue.length === 0) return;
    setIsTranslating(true);
    try {
      for (const item of fileQueue) {
        if (!selectedFileIds.has(item.id)) continue;
        if (skipCachedFiles && item.status === "done") continue;
        await translateSingleQueueItem(item.id);
        await delay(500);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  // Cancel single queue item
  const cancelSingleQueueItem = (targetId: string) => {
    requestCancel();
    setFileQueue((prev) =>
      prev.map((item) =>
        item.id === targetId ? { ...item, status: "pending", progressPercent: 0 } : item
      )
    );
  };

  const handleDownloadZipAll = async () => {
    if (translationOutputs.length === 0) return;
    try {
      const zip = new JSZip();
      for (const item of translationOutputs) {
        if (item.content) {
          zip.file(item.fileName, item.content);
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      await downloadFile(blob, "subtitles_translated.zip");
      message.success(`Đã nén & tải xuống ${translationOutputs.length} tệp phụ đề (.zip) thành công!`);
    } catch (err) {
      message.error("Lỗi khi tải hàng loạt (.zip): " + describeError(err, t));
    }
  };

  // 源文本变化时只复位"源派生"的本地预览(extractedText)。译文结果及其元数据
  // (translatedText / translatedTextExt / needsBilingualSuffix / translatedTextLang)保留——
  // 和 JSON 翻译一致:改源后旧结果不清,直到重新翻译。既符合"保留旧结果",又不必在 render
  // 阶段去 set 共享 context 的 translatedText(那会更新 TranslationProvider → setState-in-render 警告)。
  useResetOnSourceChange(sourceText, () => setExtractedText(""));

  const performTranslation = async (sourceText: string, fileNameSet?: string, fileIndex?: number, totalFiles?: number) => {
    const lines = splitTextIntoLines(sourceText);
    const fileType = detectSubtitleFormat(lines);
    if (fileType === "error") {
      message.error(tSubtitle("unsupportedSub"));
      noteFileFailure();
      return;
    }

    // Get content lines and assContentStartIndex from filterSubLines (eliminates duplicate calculation)
    const { contentLines, contentIndices, assContentStartIndex } = filterSubLines(lines, fileType);

    // Early return if no content to translate
    if (contentLines.length === 0) {
      message.warning(tSubtitle("noExtractedText"));
      noteFileFailure();
      return;
    }

    // On a failure-panel retry (runRetry) this is narrowed to the langs still
    // needing work — successful languages aren't re-walked/re-downloaded.
    const targetLangs = getActiveTargetLangs();

    if (multiLanguageMode && targetLangs.length === 0) {
      message.error(t("noTargetLanguage"));
      noteFileFailure();
      return;
    }

    // 预览语言:常规跑 = 本轮第一个语言(旧行为);多语言 scoped 重试 = 保持
    // 当前预览的语言 —— 仅当它也在重试范围内时刷新,否则不动预览。不加这条,
    // 重试会把用户正在校对的 targetLangs[0](现在是第一个【失败】语言)静默
    // 换掉;重试再失败时预览也不会被清空(runTranslation 在 scoped 重试下不清
    // translatedText)。单语言模式恒取 targetLangs[0]:预览是唯一输出。
    const previewLang = multiLanguageMode && isScopedRetry() && translatedTextLang ? (targetLangs.includes(translatedTextLang) ? translatedTextLang : null) : targetLangs[0];

    const fileName = fileNameSet || multipleFiles[0]?.name || "subtitle";
    // 源文件物理扩展名:SSA 与 ASS 共用 "ass" 管线,导出时靠它回写 .ssa
    const dotIdx = fileName.lastIndexOf(".");
    const sourceExt = dotIdx > 0 ? fileName.slice(dotIdx + 1).toLowerCase() : undefined;

    // Helper to generate subtitle output based on bilingual mode — assembly
    // itself lives in formats/subtitle assembleSubtitleOutput (shared with the CLI).
    // softFilledIndices:双语装配据此判断哪些行只出一半 —— 必须是【引擎给的
    // 软失败下标】而不是"译文==原文"的字符串比较,否则专有名词/数字/♪ 这类
    // 合法译成自身的行会被吃掉一半(见 formats/subtitle 的 isSoftFilledHalf)。
    const generateSubtitle = (isBilingual: boolean, translatedLines: string[], exportLang: string, softFilledIndices?: ReadonlySet<number>): string =>
      assembleSubtitleOutput({ lines, contentIndices, contentLines, translatedLines, fileType, assContentStartIndex, tagMaps, isBilingual, isOriginalFirst, bilingualFormat, assNativeRebuild, assStyle, sourceLanguage, exportLang, softFilledIndices });

    // ASS 标签保护：翻译前剥离覆盖标签和 \N，翻译后还原
    const isAss = fileType === "ass";
    const { cleanLines, tagMaps } = isAss ? prepareAssForTranslation(contentLines) : { cleanLines: contentLines, tagMaps: [] };

    // contentIndices 把每条 cue 文本行映射回源文件物理行 —— 失败面板要报的是
    // 用户在文件里能找到的行号,不是"第 N 条可译行"的序数。
    const sourceLineNumbers = contentIndices.map((index) => index + 1);

    // 跟踪当前文件是否有任何 lang 翻译失败;末尾合并到 failedFilesRef
    let hasFailedLang = false;

    for (const currentTargetLang of targetLangs) {
      // 取消刹车:translateBatch 的入口守卫本来也会把后续语言逐个抛掉(级联标记
      // → 下面 catch 静默 continue),在这里刹住只是不做那 N 次空转。
      if (isCancelRequested()) break;
      // 每个语言(或文件)开始前清掉上一轮的实时行 —— 新一轮结果从空列表
      // 重新累积(多语言循环里每个 lang 的流是独立的)。
      clearLiveLines();
      try {
        // Translate content using the specific target language
        // 软填(保留原文)槽位:removeChars 绝不能碰 —— 碰了就写出既非原文也非
        // 译文的东西,而失败面板同屏正说着"失败的行已保留原文"。
        // 规则与 CLI 共用同一份实现:lib/translation/softFill。
        const softFilled = new Set<number>();
        const rawTranslatedLines = await translateBatch(cleanLines, translationMethod, currentTargetLang, fileIndex, totalFiles, contextAware ? "subtitle" : undefined, {
          lineNumbers: sourceLineNumbers,
          fileName,
          collectSoftFilled: softFilled,
          // 实时逐行流:引擎每定稿一行就推一个事件,这里立刻上屏 —— 不等整批
          // 返回。「这一行最终没译出」的标记由 hook 在失败面板更新时统一处理
          // (markLiveLinesFailed),这里只管内容流。
          //
          // ⚠ ASS 必须在这里还原成人能读的形态。发给引擎的是 cleanLines
          // (prepareAssForTranslation 把 `\N`+标签串换成了 ###n### 占位符),
          // 引擎忠实地把它当"原文"发回来 —— 直接上屏就是满面板的 ###0###。
          // 原文取 contentLines(文件里的真样子),译文过一遍与导出同一个
          // restoreAssAfterTranslation:面板看到的和最终文件里的是同一形态。
          onLineTranslated: (result) => {
            recordLiveLine(
              isAss
                ? {
                    ...result,
                    original: contentLines[result.index] ?? result.original,
                    translation: restoreAssAfterTranslation([result.translation], [tagMaps[result.index]])[0],
                  }
                : result,
            );
          },
        });
        // removeChars 只清理【原始译文】,且必须在 ASS 标签/verbatim 还原【之前】
        // 应用 —— restore 之后应用会损坏 \N 硬换行、{\anX} 标签和绘图坐标行。
        // ASS 用 token 感知版(跳过 ###n### 保护槽),其余格式用通用版;
        // 实现与 CLI 共用同一份(formats/subtitle + textUtils)。
        const cleanedTranslated = transformSkippingSoftFilled(rawTranslatedLines, softFilled, (ls) => (isAss ? applyRemoveCharsToAssLines(ls, removeChars) : applyRemoveCharsToLines(ls, removeChars)));
        const translatedLines = isAss ? restoreAssAfterTranslation(cleanedTranslated, tagMaps) : cleanedTranslated;

        // Generate file name base
        const langLabel = currentTargetLang;

        // Handle different export modes
        if (exportMode === "both") {
          // Generate both translated-only and bilingual versions
          const translatedOnlySubtitle = generateSubtitle(false, translatedLines, currentTargetLang, softFilled);
          const bilingualSubtitle = generateSubtitle(true, translatedLines, currentTargetLang, softFilled);
          const translatedOnlyExt = getOutputFileExtension(fileType, false, bilingualFormat, sourceExt);
          const bilingualExt = fileType === "ass" && assNativeRebuild ? "ass" : getOutputFileExtension(fileType, true, bilingualFormat, sourceExt);

          const translatedOnlyFileName = generateFileName(fileName, langLabel, translatedOnlyExt, multiLanguageMode);
          const bilingualFileName = appendBilingualSuffix(generateFileName(fileName, langLabel, bilingualExt, multiLanguageMode));

          // Collect outputs for UI per-file download & bulk ZIP download (NO auto-download popups!)
          setTranslationOutputs((prev) => [
            ...prev.filter((p) => p.key !== translatedOnlyFileName && p.key !== bilingualFileName),
            { key: translatedOnlyFileName, fileName: translatedOnlyFileName, status: "done", content: translatedOnlySubtitle },
            { key: bilingualFileName, fileName: bilingualFileName, status: "done", content: bilingualSubtitle },
          ]);

          if (currentTargetLang === previewLang) {
            setTranslatedText(bilingualSubtitle);
            setTranslatedTextExt(bilingualExt);
            setNeedsBilingualSuffix(true);
            setTranslatedTextBilingual(true);
            setTranslatedTextLang(currentTargetLang);
          }
        } else {
          // Generate single version based on mode
          const finalSubtitle = generateSubtitle(needsBilingual, translatedLines, currentTargetLang, softFilled);
          const fileExt = fileType === "ass" && needsBilingual && assNativeRebuild ? "ass" : getOutputFileExtension(fileType, needsBilingual, bilingualFormat, sourceExt);
          const downloadFileName = generateFileName(fileName, langLabel, fileExt, multiLanguageMode);

          // Collect output for UI per-file download & bulk ZIP download (NO auto-download popups!)
          setTranslationOutputs((prev) => [
            ...prev.filter((p) => p.key !== downloadFileName),
            { key: downloadFileName, fileName: downloadFileName, status: "done", content: finalSubtitle },
          ]);

          // Save to persistent Disk Cache (IndexedDB) formatted as ten_goc.[ngon_ngu].[timestamp].[md5].[ext]
          const inputMd5 = computeFileMd5(sourceText);
          void saveFileToDiskCache(fileName, currentTargetLang, inputMd5, fileExt, finalSubtitle);

          if (currentTargetLang === previewLang) {
            setTranslatedText(finalSubtitle);
            setTranslatedTextExt(fileExt);
            setNeedsBilingualSuffix(false);
            setTranslatedTextBilingual(needsBilingual);
            setTranslatedTextLang(currentTargetLang);
          }
        }

        if (multiLanguageMode && currentTargetLang !== targetLangs[targetLangs.length - 1]) {
          await delay(500);
        }
      } catch (error: unknown) {
        console.error(error);

        // Cascaded abort = peer auth error already aborted the controller;
        // the real auth error surfaces via the matching peer rejection. Skip
        // the noisy secondary toast.
        if (isCascadedAbort(error)) continue;

        hasFailedLang = true;
        // De-duped: multi-file batch can fire catch for the same lang per file.
        setFailedLangs((prev) => (prev.includes(currentTargetLang) ? prev : [...prev, currentTargetLang]));
        const friendly = isNetworkError(error) ? t("networkUnavailable") : isAbortError(error) ? t("translationTimeout") : null;
        const langLabel = sourceOptions.find((o) => o.value === currentTargetLang)?.label || currentTargetLang;
        // Friendly messages already convey "translation failed" — drop the
        // redundant `${t("translationError")}` suffix, keep langLabel in
        // parentheses for multi-language context.
        const content = friendly
          ? `${friendly} (${langLabel})`
          : needsBilingual
            ? `${describeError(error, t)} ${tSubtitle("bilingualError")}`
            : `${describeError(error, t)} ${langLabel} ${t("translationError")}`;

        // Shared key: failed languages roll into one toast instead of stacking N high
        // — the TranslateFailurePanel keeps the full per-lang list.
        message.error({ content, key: "translate-lang-fail", duration: 10 });
      }
    }

    if (hasFailedLang) noteFileFailure();

    // Show success message after all languages completed (for single file multi-language mode);
    // 有任何 lang 失败时跳过此消息(per-lang error toast 已显示,避免红+绿对冲)
    // isDisposed:中途导航离开时每个 lang 都按级联静默 continue,hasFailedLang
    // 仍是 false —— 不挡会在用户切去的页面上弹"已导出 N 个文件"的假成功。
    // 不设 length > 1 门槛:多语言模式必自动下载(哪怕只剩 1 个语言 —— 单语言
    // scoped 重试就是这个形态),没有 toast 的话用户只看到面板消失 + 一次静默
    // 下载,会误判重试没生效。
    if (multiLanguageMode && multipleFiles.length <= 1 && !hasFailedLang && !isDisposed() && !isCancelRequested()) {
      const fileCount = exportMode === "both" ? targetLangs.length * 2 : targetLangs.length;
      message.success(`${t("translationExported")} (${fileCount} ${t("exportedFile")})`);
    }
  };

  const handleMultipleTranslate = async () => {
    if (multipleFiles.length === 0) {
      message.error(tSubtitle("noFileUploaded"));
      return;
    }

    // validate 不再自管 isTranslating, 这里用 try/finally 兜底,
    // 让 progress modal 在 test ping → 文件循环之间保持连续可见。
    setIsTranslating(true);
    // resetProgress 而非裸 setProgressPercent(0):progressInfo 的
    // {current,total,latest} 不清,投影弹窗会在新一轮首行返回前(LLM 批次
    // 可达 20-60s)一直放映【上一轮】的最终计数和最后一句译文。
    resetProgress();
    // 批量路径:整批文件开跑前清掉实时行(单文件路径由 runTranslation →
    // performTranslation 的 clearLiveLines 清)。
    clearLiveLines();
    failedFilesRef.current = 0;
    // Batch path doesn't go through the hook's runTranslation — reset ALL failure
    // state (not just langs) so counts don't accumulate across runs and the failure
    // warning re-fires on a fresh batch.
    clearFailures();

    try {
      const isValid = await validate();
      if (!isValid) return;

      for (let i = 0; i < multipleFiles.length; i++) {
        const currentFile = multipleFiles[i];
        await new Promise<void>((resolve) => {
          readFile(
            currentFile,
            async (text) => {
              await performTranslation(text, currentFile.name, i, multipleFiles.length);
              await delay(1500);
              resolve();
            },
            // Decode/read failure: mark this file failed (so succeeded=total-failed is
            // accurate) and unblock the loop.
            () => {
              noteFileFailure();
              resolve();
            }
          );
        });
        if (isDisposed() || isCancelRequested()) return;
      }

      if (!isCancelRequested()) setProgressPercent((p) => (p > 0 ? 100 : p));
      const total = multipleFiles.length;
      const failed = failedFilesRef.current;
      const succeeded = total - failed;
      if (failed === 0 && !hadRunFailures()) {
        message.success(t("translationExported"), 10);
      } else if (succeeded > 0) {
        message.warning(`${t("translationExported")} (${succeeded}/${total})`, 10);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const handleExportFile = () => {
    const uploadFileName = multipleFiles[0]?.name || "subtitle";
    const fileExt = translatedTextExt ?? "srt";
    const langLabel = translatedTextLang ?? targetLanguage;

    let fileName = generateFileName(uploadFileName, langLabel, fileExt, multiLanguageMode);
    if (needsBilingualSuffix) {
      fileName = appendBilingualSuffix(fileName);
    }
    void downloadFile(translatedText, fileName);
    message.success(t("fileExported", { fileName }));
  };

  const handleExtractText = () => {
    if (!sourceText.trim()) {
      message.warning(tSubtitle("noSourceText"));
      return;
    }
    if (!sourceFileType || sourceFileType === "error") {
      message.error(tSubtitle("unsupportedSub"));
      return;
    }
    const { contentLines } = filterSubLines(splitTextIntoLines(sourceText), sourceFileType);
    const extractedText = contentLines.join("\n").trim();

    if (!extractedText) {
      message.error(tSubtitle("noExtractedText"));
      return;
    }

    setExtractedText(extractedText);
    copyToClipboard(extractedText, tSubtitle("textExtracted"));
  };

  const clearResults = () => {
    setTranslatedText("");
    setTranslatedTextExt(null);
    setNeedsBilingualSuffix(false);
    setTranslatedTextBilingual(false);
    setTranslatedTextLang(null);
    setBilingualTask(null);
    setSplitTask(null);
    setTranslationOutputs([]);
    clearLiveLines();
    clearFailures();
  };

  const customHeadline = useMemo(() => {
    if (!characterGraphEnabled) return undefined;
    if (translationPhase === "graph") return t.has("stepGraphExtract") ? t("stepGraphExtract") : "Bước 1/2: Đang phân tích Đồ thị quan hệ & xưng hô...";
    if (translationPhase === "translating" && (isTranslating || progressPercent > 0)) return t.has("stepTranslating") ? t("stepTranslating") : "Bước 2/2: Đang dịch nội dung phụ đề...";
    if (translationPhase === "done" && progressPercent >= 100) return t.has("stepGraphDone") ? t("stepGraphDone") : "Hoàn tất (Đã áp dụng quy tắc xưng hô)";
    return undefined;
  }, [characterGraphEnabled, translationPhase, isTranslating, progressPercent, t]);

  return (
    <>
      <Tabs
        type="card"
        activeKey={mainTabKey}
        onChange={setMainTabKey}
        style={{ marginBottom: 16 }}
        items={[
          {
            key: "context",
            label: (
              <Space>
                <BookOutlined />
                <Text strong>📖 Thiết lập Bối cảnh & Nhân vật</Text>
              </Space>
            ),
            children: (
              <Row gutter={[24, 24]}>
                {/* Left Column: Movie Context Builder */}
                <Col xs={24} lg={14} xl={15}>
                  <MovieContextBuilder onProcessingChange={setIsContextProcessing} disabled={isAnyApiRunning} />
                </Col>

                {/* Right Column: Dedicated Context Provider/Model Config */}
                <Col xs={24} lg={10} xl={9}>
                  <Card
                    title={
                      <Space>
                        <ApiOutlined />
                        <Text strong>Cấu hình API & Model Bối cảnh</Text>
                      </Space>
                    }
                    style={cardStyle}
                    extra={
                      <Space>
                        <Tooltip title={t("exportSettingTooltip")}>
                          <Button
                            type="text"
                            icon={<SaveOutlined />}
                            size="small"
                            disabled={isAnyApiRunning}
                            onClick={async () => {
                              await exportSettings();
                            }}
                            aria-label={t("exportSettingTooltip")}
                          />
                        </Tooltip>
                        <Tooltip title={t("importSettingTooltip")}>
                          <Button
                            type="text"
                            icon={<ImportOutlined />}
                            size="small"
                            disabled={isAnyApiRunning}
                            onClick={async () => {
                              await importSettings();
                            }}
                            aria-label={t("importSettingTooltip")}
                          />
                        </Tooltip>
                        <Tooltip title="Cấu hình nâng cao Provider">
                          <Button
                            type="text"
                            icon={<GlobalOutlined />}
                            size="small"
                            disabled={isAnyApiRunning}
                            onClick={() => setApiSettingsOpen(true)}
                            aria-label="Cấu hình nâng cao Provider"
                          />
                        </Tooltip>
                      </Space>
                    }>
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
                      Cấu hình nhà cung cấp AI & Model được sử dụng riêng cho việc phân tích bối cảnh và trích xuất quan hệ nhân vật chi tiết.
                    </Typography.Paragraph>
                    <Form layout="vertical">
                      <Form.Item label="Provider Bối cảnh" style={{ marginBottom: 12 }}>
                        <Select
                          value={characterGraphProvider}
                          onChange={setCharacterGraphProvider}
                          options={categorizedOptions}
                          disabled={isAnyApiRunning}
                        />
                      </Form.Item>
                      <Form.Item label={`${findMethodLabel(characterGraphProvider)} API Key`} style={{ marginBottom: 12 }}>
                        <Input.Password
                          placeholder="API Key cho Bối cảnh"
                          value={activeGraphConfig.apiKey || ""}
                          onChange={(e) => updateCharacterGraphConfig(characterGraphProvider, { apiKey: e.target.value })}
                          disabled={isAnyApiRunning}
                        />
                      </Form.Item>
                      <Form.Item label="Model Bối cảnh (VD: gemini-2.5-flash)" style={{ marginBottom: 12 }}>
                        <AutoComplete
                          options={(getProviderModels(characterGraphProvider) as Array<{ label: string; value: string }>).map((m) => ({
                            label: m.label || m.value,
                            value: m.value,
                          }))}
                          placeholder="Mô hình ID"
                          value={activeGraphConfig.model || ""}
                          onChange={(val) => updateCharacterGraphConfig(characterGraphProvider, { model: val ?? "" })}
                          disabled={isAnyApiRunning}
                        />
                      </Form.Item>
                    </Form>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: "translate",
            label: (
              <Space>
                <InboxOutlined />
                <Text strong>🎬 Dịch phụ đề</Text>
              </Space>
            ),
            children: (
              <>
                <Row gutter={[24, 24]}>
                {/* Left Column: Upload and Main Actions */}
                <Col xs={24} lg={14} xl={15}>
                  <Card
                    title={
                      <Space>
                        <InboxOutlined /> {t("sourceArea")}
                      </Space>
                    }
                    extra={
                      <Space>
                        {fileList.length > 0 && (
                          <Button
                            type="text"
                            icon={collapseInputList ? <DownOutlined /> : <UpOutlined />}
                            onClick={() => setCollapseInputList(!collapseInputList)}>
                            {collapseInputList
                              ? `${t.has("expandList") ? t("expandList") : "Hiện danh sách"} (${fileList.length})`
                              : t.has("collapseList") ? t("collapseList") : "Thu gọn danh sách"}
                          </Button>
                        )}
                        <Tooltip title={t("resetUploadTooltip")}>
                          <Button
                            type="text"
                            danger
                            disabled={isTranslating}
                            onClick={() => {
                              resetUpload();
                              clearResults();
                              message.success(t("resetUploadSuccess"));
                            }}
                            icon={<ClearOutlined />}
                            aria-label={t("clearAll")}>
                            {t("clearAll")}
                          </Button>
                        </Tooltip>
                      </Space>
                    }
                    style={cardStyle}>
                    <Dragger
                      disabled={isTranslating}
                      customRequest={({ file }) => {
                        clearResults();
                        handleFileUpload(file as File);
                      }}
                      accept={uploadFileTypes.accept}
                      multiple={!singleFileMode}
                      showUploadList={fileQueue.length > 0 ? false : !collapseInputList}
                      beforeUpload={singleFileMode ? resetUpload : undefined}
                      onRemove={(file) => {
                        clearResults();
                        return handleUploadRemove(file);
                      }}
                      onChange={handleUploadChange}
                      fileList={fileList}>
                      <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                      </p>
                      <p className="ant-upload-text">{t("dragAndDropText")}</p>
                      <p className="ant-upload-hint">
                        {t("supportedFormats")} {uploadFileTypes.label}
                      </p>
                    </Dragger>

                    {/* Multi-file Queue Table (Flat Container) */}
                    {fileQueue.length > 0 && (
                      <div className="mt-3">
                        {/* Unified Single Column Title Header */}
                        <div
                          style={{
                            padding: "8px 12px",
                            background: token.colorFillAlter,
                            borderRadius: token.borderRadiusSM,
                            marginBottom: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            color: token.colorTextSecondary,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            border: `1px solid ${token.colorBorderSecondary}`,
                          }}>
                          <Space size="small">
                            <Checkbox
                              checked={isAllSelected}
                              indeterminate={isIndeterminate}
                              onChange={(e) => handleToggleSelectAll(e.target.checked)}
                            />
                            <FolderOpenOutlined style={{ color: token.colorPrimary, fontSize: 15 }} />
                            <span>Tên File Subtitle ({fileQueue.length})</span>
                          </Space>
                          <Space size="middle">
                            <span>Trạng thái & Thao tác</span>
                          </Space>
                        </div>

                        {/* File Rows List */}
                        <Flex vertical gap="small" style={{ maxHeight: 280, overflowY: "auto" }}>
                          {fileQueue.map((item) => {
                            const output = translationOutputs.find((o) => o.fileName.includes(item.fileName) || item.fileName.includes(o.fileName));
                            const isChecked = selectedFileIds.has(item.id);

                            return (
                              <Card
                                key={item.id}
                                size="small"
                                style={{
                                  background: isChecked ? token.colorPrimaryBg : token.colorFillAlter,
                                  borderColor: isChecked ? token.colorPrimaryBorder : token.colorBorderSecondary,
                                  borderRadius: token.borderRadiusSM,
                                }}
                                styles={{ body: { padding: "8px 12px" } }}>
                                <Flex align="center" justify="space-between" wrap gap={8}>
                                  <Space size="small" wrap style={{ minWidth: 0, flex: 1 }}>
                                    <Checkbox
                                      checked={isChecked}
                                      onChange={(e) => handleToggleSelectRow(item.id, e.target.checked)}
                                    />
                                    <FileTextOutlined style={{ fontSize: 14, color: token.colorPrimary }} />
                                    <Typography.Text strong ellipsis style={{ fontSize: 12, maxWidth: 200 }}>
                                      {item.fileName}
                                    </Typography.Text>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      ({Math.round(item.fileSize / 1024)} KB)
                                    </Text>

                                    {/* Status Tags */}
                                    {item.status === "translating" && (
                                      <Tag color="processing" icon={<Spin size="small" style={{ marginRight: 4 }} />}>
                                        ⏳ Đang dịch...
                                      </Tag>
                                    )}
                                    {item.status === "done" && <Tag color="success" icon={<CheckCircleOutlined />}>✔ Đã dịch</Tag>}
                                    {item.status === "error" && <Tag color="error" icon={<CloseCircleOutlined />}>❌ Dịch thất bại</Tag>}
                                  </Space>

                                  {/* Independent Action Icon Buttons Per File */}
                                  <Space size="small" wrap>
                                    {(item.status === "pending" || item.status === "error") && (
                                      <Tooltip title="Bắt đầu dịch file này">
                                        <Button
                                          size="small"
                                          type="primary"
                                          ghost
                                          icon={<PlayCircleOutlined />}
                                          disabled={isTranslating}
                                          onClick={() => translateSingleQueueItem(item.id)}
                                        />
                                      </Tooltip>
                                    )}

                                    {item.status === "translating" && (
                                      <Tooltip title="Hủy dịch file này">
                                        <Button
                                          size="small"
                                          danger
                                          icon={<StopOutlined />}
                                          onClick={() => cancelSingleQueueItem(item.id)}
                                        />
                                      </Tooltip>
                                    )}

                                    {item.status === "done" && output?.content && (
                                      <Tooltip title="Tải xuống tệp phụ đề dịch">
                                        <Button
                                          size="small"
                                          type="primary"
                                          icon={<DownloadOutlined />}
                                          onClick={() => downloadFile(output.content!, output.fileName)}
                                        />
                                      </Tooltip>
                                    )}

                                    {item.inputMd5 && (
                                      <Tooltip title="Xóa bản dịch đã lưu trong Cache cho tệp này">
                                        <Popconfirm
                                          title="Xóa cache tệp này?"
                                          description="Bạn có chắc chắn muốn xóa bản dịch đã lưu trong cache cho tệp này không?"
                                          okText="Xóa Cache"
                                          cancelText="Hủy"
                                          okButtonProps={{ danger: true }}
                                          onConfirm={async () => {
                                            const cacheId = `${item.inputMd5}::${targetLanguage}`;
                                            await deleteDiskCacheItem(cacheId);
                                            setTranslationOutputs((prev) => prev.filter((o) => !o.fileName.includes(item.fileName)));
                                            setFileQueue((prev) =>
                                              prev.map((f) => (f.id === item.id ? { ...f, status: "pending", cachedFileName: undefined } : f))
                                            );
                                            message.success(`Đã xóa cache tệp: ${item.fileName}`);
                                          }}>
                                          <Button
                                            size="small"
                                            danger
                                            icon={<ClearOutlined />}
                                            disabled={isTranslating}
                                          />
                                        </Popconfirm>
                                      </Tooltip>
                                    )}

                                    <Tooltip title="Xóa file khỏi danh sách">
                                      <Button
                                        size="small"
                                        danger
                                        ghost
                                        icon={<DeleteOutlined />}
                                        disabled={isTranslating}
                                        onClick={() => removeSingleFileFromQueue(item.id)}
                                      />
                                    </Tooltip>
                                  </Space>
                                </Flex>

                                {item.status === "error" && item.errorMessage && (
                                  <Text type="danger" style={{ fontSize: 11, display: "block", marginTop: 4, marginLeft: 24 }}>
                                    Lỗi: {item.errorMessage}
                                  </Text>
                                )}
                              </Card>
                            );
                          })}
                        </Flex>
                      </div>
                    )}

                    {uploadMode === "single" && (
                      <SourceArea
                        locked={isTranslating}
                        sourceText={sourceText}
                        setSourceText={setSourceText}
                        stats={sourceStats}
                        placeholder={t("pasteUploadContent")}
                        ariaLabel={t("sourceArea")}
                        className="mt-1"
                      />
                    )}

                    <Divider />

                    {/* Sorted & Compact Action Bar */}
                    <Flex gap="small" wrap className="mt-auto pt-3" align="center">
                      {/* 1. Primary Action Button: Translate / Cancel */}
                      {isTranslating ? (
                        <Popconfirm
                          title="Hủy quá trình dịch"
                          description="Bạn có chắc chắn muốn hủy quá trình dịch các tệp đang chạy không?"
                          okText="Hủy quá trình dịch"
                          cancelText="Tiếp tục dịch"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => {
                            requestCancel();
                            setIsTranslating(false);
                            message.info("Đã hủy quá trình dịch.");
                          }}>
                          <Button
                            type="primary"
                            danger
                            size="middle"
                            icon={<StopOutlined />}
                            loading={isTranslating}>
                            ⏳ Đang dịch... (Bấm để Hủy)
                          </Button>
                        </Popconfirm>
                      ) : (
                        <Button
                          type="primary"
                          size="middle"
                          icon={<GlobalOutlined spin={isTranslating} />}
                          onClick={async () => {
                            if (!bilingualTask?.isProcessing) setBilingualTask(null);
                            if (!splitTask?.isProcessing) setSplitTask(null);

                            if (sourceFileType === "ass") {
                              let checkText = sourceText;
                              if (uploadMode === "multiple" && multipleFiles.length > 0 && !checkText) {
                                checkText = await new Promise<string>((resolve) => readFile(multipleFiles[0], (text) => resolve(text ?? ""), () => resolve("")));
                              }
                              if (checkText) {
                                const styles = parseAssDialogueStyles(checkText);
                                const detection = detectAssLanguageGroups(styles);
                                if (detection.mainGroups.length > 1) {
                                  setBilingualTranslateModalOpen(true);
                                  return;
                                }
                              }
                            }

                            if (uploadMode === "single") {
                              runTranslation(performTranslation, sourceText, contextAware ? "subtitle" : undefined);
                            } else {
                              handleTranslateAllQueue();
                            }
                          }}
                          disabled={uploadMode === "multiple" && pendingSelectedCount === 0}>
                          {uploadMode === "multiple" || fileQueue.length > 0
                            ? `🚀 Dịch file đã chọn (${pendingSelectedCount})`
                            : multiLanguageMode
                            ? `${t("translate")} (${targetLanguages.length})`
                            : t("translate")}
                        </Button>
                      )}

                      {/* 2. Download Selected / All Zip Button */}
                      {fileQueue.length > 0 && (
                        <Button
                          size="middle"
                          icon={isAllSelected ? <FileZipOutlined /> : <DownloadOutlined />}
                          onClick={handleDownloadSelectedOrAll}
                          disabled={isTranslating || selectedFileIds.size === 0}>
                          {isAllSelected ? "Tải tất cả (.zip)" : `Tải file chọn (${selectedFileIds.size})`}
                        </Button>
                      )}

                      {/* 3. AI Audit Shortcut Button */}
                      {fileQueue.some((f) => f.status === "done") && (
                        <Button
                          size="middle"
                          icon={<SearchOutlined />}
                          onClick={() => setMainTabKey("review")}>
                          🔍 Kiểm duyệt AI
                        </Button>
                      )}

                      {/* 3. Tools: Extract / Split */}
                      {uploadMode === "single" && sourceText && (
                        <Button size="middle" onClick={handleExtractText} icon={<FormatPainterOutlined />}>
                          {t("extractText")}
                        </Button>
                      )}

                      {(uploadMode === "single" ? !!sourceText : multipleFiles.length > 0) && sourceFileType === "ass" && (
                        <Button size="middle" onClick={() => setSplitModalOpen(true)} icon={<ScissorOutlined />}>
                          Tách song ngữ
                        </Button>
                      )}

                      {/* 5. Clear Cache Button */}
                      <Popconfirm
                        title="Xóa bộ nhớ đệm Cache phụ đề"
                        description="Bạn có chắc muốn xóa toàn bộ các tệp phụ đề đã dịch & câu dịch đệm? (Giữ nguyên bối cảnh & nhân vật)"
                        okText="Xóa Cache Phụ đề"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                          try {
                            const diskCount = await clearAllDiskCache();
                            const lineCount = await translationCache.clear();
                            setTranslationOutputs([]);
                            setFileQueue((prev) =>
                              prev.map((item) => ({ ...item, status: "pending", cachedFileName: undefined }))
                            );
                            message.success(`Đã xóa cache phụ đề! (${diskCount} tệp & ${lineCount} câu dịch - Giữ nguyên bối cảnh & nhân vật)`);
                          } catch (err) {
                            message.error("Lỗi khi xóa bộ nhớ cache.");
                          }
                        }}>
                        <Tooltip title="Xóa toàn bộ Cache file phụ đề đã dịch (Giữ nguyên bối cảnh & nhân vật)">
                          <Button
                            size="middle"
                            danger
                            ghost
                            icon={<ClearOutlined />}
                            disabled={isTranslating}>
                            Xóa Cache phụ đề
                          </Button>
                        </Tooltip>
                      </Popconfirm>

                      {/* 4. Clear List / Delete Icon Button (With Popconfirm & Tooltip) */}
                      {fileQueue.length > 0 && (
                        <Popconfirm
                          title="Xóa danh sách tệp phụ đề"
                          description="Bạn có chắc chắn muốn xóa toàn bộ danh sách tệp phụ đề và kết quả dịch hiện tại không?"
                          okText="Đồng ý xóa"
                          cancelText="Hủy"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => {
                            resetUpload();
                            clearResults();
                            message.info("Đã xóa danh sách tệp phụ đề.");
                          }}>
                          <Tooltip title="Xóa toàn bộ danh sách tệp">
                            <Button
                              danger
                              size="middle"
                              icon={<DeleteOutlined />}
                              disabled={isTranslating}
                              aria-label="Xóa danh sách"
                            />
                          </Tooltip>
                        </Popconfirm>
                      )}
                    </Flex>

                    {/* Option Row Below */}
                    {fileQueue.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Checkbox
                          checked={skipCachedFiles}
                          disabled={isTranslating}
                          onChange={(e) => setSkipCachedFiles(e.target.checked)}>
                          <Text style={{ fontSize: 12 }}>Bỏ qua file đã dịch (Cache 24h)</Text>
                        </Checkbox>
                      </div>
                    )}

                    {bilingualTask ? (
                      <BackgroundBatchProgressStrip
                        task={bilingualTask}
                        onOpenModal={() => setBilingualTranslateModalOpen(true)}
                        onDismiss={() => setBilingualTask(null)}
                      />
                    ) : splitTask ? (
                      <BackgroundBatchProgressStrip
                        task={splitTask}
                        onOpenModal={() => setSplitModalOpen(true)}
                        onDismiss={() => setSplitTask(null)}
                      />
                    ) : (
                      <TranslationProgressStrip
                        isTranslating={isTranslating}
                        percent={progressPercent}
                        onCancel={requestCancel}
                        resumable={useCache}
                        onDismiss={resetProgress}
                        multiLanguageMode={multiLanguageMode}
                        targetLanguageCount={targetLanguages.length}
                        failed={failedCount > 0 || failedLangs.length > 0 || runHadFailures}
                        lineFailures={failedCount > 0}
                        currentCount={progressInfo.current}
                        totalCount={progressInfo.total}
                        customHeadline={customHeadline}
                      />
                    )}

                    {isTranslating && <LiveTranslationResults store={liveLinesStore} processedCount={progressInfo.current} />}
                  </Card>
                </Col>

                {/* Right Column: Settings and Configuration */}
                <Col xs={24} lg={10} xl={9}>
                  <Card
                    title={<Space><SettingOutlined /> {t("configuration")}</Space>}
                    style={cardStyle}
                    extra={
                      <Space>
                        <Tooltip title={t("exportSettingTooltip")}>
                          <Button
                            type="text"
                            icon={<SaveOutlined />}
                            size="small"
                            disabled={isTranslating}
                            onClick={async () => {
                              await exportSettings();
                            }}
                            aria-label={t("exportSettingTooltip")}
                          />
                        </Tooltip>
                        <Tooltip title={t("importSettingTooltip")}>
                          <Button
                            type="text"
                            icon={<ImportOutlined />}
                            size="small"
                            disabled={isTranslating}
                            onClick={async () => {
                              await importSettings();
                            }}
                            aria-label={t("importSettingTooltip")}
                          />
                        </Tooltip>
                        <Tooltip title={t("batchEditMultiLangTooltip")}>
                          <Button type="text" icon={<GlobalOutlined />} size="small" disabled={isTranslating} onClick={() => setMultiLangModalOpen(true)} aria-label={t("batchEditMultiLangTooltip")} />
                        </Tooltip>
                      </Space>
                    }>
                    <Form layout="vertical" className="w-full !mb-3">
                      <LanguageSelector
                        sourceLanguage={sourceLanguage}
                        targetLanguage={targetLanguage}
                        targetLanguages={targetLanguages}
                        multiLanguageMode={multiLanguageMode}
                        handleLanguageChange={handleLanguageChange}
                        handleSwapLanguages={handleSwapLanguages}
                        setTargetLanguages={setTargetLanguages}
                        setMultiLanguageMode={setMultiLanguageMode}
                        disabled={isTranslating}
                      />
                    </Form>

                    <ApiStatusBlock disabled={isTranslating} />

                    {LLM_MODELS.includes(translationMethod) && (
                      <ContextTranslationBlock
                        enabled={contextAware}
                        onEnabledChange={setContextAware}
                        disabled={isTranslating}
                      />
                    )}

                    <Collapse
                      ghost
                      size="small"
                      activeKey={collapseKeys}
                      onChange={(keys) => setCollapseKeys(typeof keys === "string" ? [keys] : keys)}
                      items={[
                        {
                          key: "subtitle",
                          label: (
                            <Space>
                              <FileTextOutlined />
                              <Text strong>{tSubtitle("subtitleFormat")}</Text>
                            </Space>
                          ),
                          children: (
                            <div
                              style={{
                                padding: token.paddingSM,
                                background: "transparent",
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: token.borderRadiusLG,
                                display: "flex",
                                flexDirection: "column",
                                gap: token.marginXS,
                              }}>
                              {sourceText.trim() && sourceFileType === "error" && (
                                <Alert type="warning" showIcon title={tSubtitle("unsupportedSub")} />
                              )}
                              <Segmented
                                disabled={isTranslating}
                                block
                                size="small"
                                value={exportMode}
                                onChange={(value) => setExportMode(value as "translatedOnly" | "bilingual" | "both")}
                                options={[
                                  { label: tSubtitle("translatedOnly"), value: "translatedOnly" },
                                  { label: tSubtitle("bilingual"), value: "bilingual" },
                                  {
                                    label: (
                                      <Tooltip title={tSubtitle("bilingualTooltip")}>
                                        <div>{tSubtitle("exportBoth")}</div>
                                      </Tooltip>
                                    ),
                                    value: "both",
                                  },
                                ]}
                              />

                              {needsBilingual && (
                                <Segmented
                                  disabled={isTranslating}
                                  block
                                  size="small"
                                  value={bilingualOrder}
                                  onChange={(value) => setBilingualOrder(value as BilingualOrder)}
                                  options={[
                                    { label: tSubtitle("translationFirst"), value: "translationFirst" },
                                    { label: tSubtitle("originalFirst"), value: "originalFirst" },
                                  ]}
                                />
                              )}

                      {showBilingualFormatChoice && (
                        <Tooltip title={tSubtitle("bilingualFormatTooltip")}>
                          <Segmented
                        disabled={isTranslating}
                            block
                            size="small"
                            value={bilingualFormat}
                            onChange={(value) => setBilingualFormat(value as BilingualFormat)}
                            options={[
                              { label: "ASS", value: "ass" },
                              { label: "SRT", value: "srt" },
                            ]}
                          />
                        </Tooltip>
                      )}

                      {showNativeRebuildChoice && (
                        <Tooltip title={tSubtitle("assNativeModeTooltip")}>
                          <Segmented
                        disabled={isTranslating}
                            block
                            size="small"
                            value={assNativeRebuild ? "rebuild" : "source"}
                            onChange={(value) => setAssNativeRebuild(value === "rebuild")}
                            options={[
                              { label: tSubtitle("assNativeModeSource"), value: "source" },
                              { label: tSubtitle("assNativeModeRebuild"), value: "rebuild" },
                            ]}
                          />
                        </Tooltip>
                      )}

                      {showAssStyle && (
                        <Tooltip title={tSubtitle("assStyleTooltip")}>
                          <Button size="small" icon={<FormatPainterOutlined />} disabled={isTranslating} onClick={() => setAssStyleOpen(true)}>
                            {tSubtitle("assStyleButton")}
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  ),
                },
                {
                  key: "advanced",
                  label: (
                    <Space>
                      <ControlOutlined />
                      <Text strong>{t("advancedSettings")}</Text>
                    </Space>
                  ),
                  children: (
                    <AdvancedTranslationSettings
                      disabled={isTranslating}
                      customFileName={customFileName}
                      setCustomFileName={setCustomFileName}
                      removeChars={removeChars}
                      setRemoveChars={setRemoveChars}
                      retryCount={retryCount}
                      setRetryCount={setRetryCount}
                      requestTimeoutSec={requestTimeoutSec}
                      setRequestTimeoutSec={setRequestTimeoutSec}
                      useCache={useCache}
                      setUseCache={setUseCache}
                      characterGraphEnabled={characterGraphEnabled}
                      setCharacterGraphEnabled={setCharacterGraphEnabled}
                      characterGraphProvider={characterGraphProvider}
                      setCharacterGraphProvider={setCharacterGraphProvider}
                      getCharacterGraphConfig={getCharacterGraphConfig}
                      updateCharacterGraphConfig={updateCharacterGraphConfig}
                      setApiSettingsOpen={setApiSettingsOpen}
                      translationMethod={translationMethod}
                      activeModel={getSelectedConfig()?.model}
                      singleFileMode={singleFileMode}
                      setSingleFileMode={setSingleFileMode}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Partial-failure panel: auto-retried once, still-failed lines kept originals */}
      <TranslateFailurePanel
        count={failedCount}
        lines={failedLines}
        failedLangs={failedLangs}
        reason={failedReason}
        disabled={isTranslating}
        onRetry={() => (uploadMode === "single" ? runTranslation(performTranslation, sourceText, contextAware ? "subtitle" : undefined) : handleMultipleTranslate())}
      />

      {/* Results Section */}
      {uploadMode === "single" && (translatedText || extractedText) && (
        <div className="mt-6">
          <Row gutter={[24, 24]}>
            {translatedText && !(multiLanguageMode && targetLanguages.length > 1) && (
              <Col xs={24} lg={extractedText ? 12 : 24}>
                <ResultCard
                  title={t("translationResult")}
                  content={resultStats.displayText}
                  charCount={resultStats.charCount}
                  lineCount={resultStats.lineCount}
                  onCopy={() => copyToClipboard(translatedText)}
                  onExport={handleExportFile}
                />
              </Col>
            )}

            {extractedText && (
              <Col xs={24} lg={translatedText ? 12 : 24}>
                <Card
                  title={
                    <Space>
                      <FileTextOutlined /> {t("extractedText")}
                    </Space>
                  }
                  className="h-full"
                  style={{ boxShadow: token.boxShadowTertiary }}
                  extra={
                    <Button type="text" icon={<CopyOutlined />} onClick={() => copyToClipboard(extractedText)}>
                      {t("copy")}
                    </Button>
                  }>
                  <TextArea value={extractedText} rows={10} readOnly aria-label={t("extractedText")} />
                </Card>
              </Col>
            )}
          </Row>
        </div>
      )}

      {/* 对照校对:源↔译逐行并排、可编辑译文,应用后写回下载(全部格式,含 lrc)。
          仅 translatedOnly 模式,且【产物本身】非双语(translatedTextBilingual)——
          只看当前 exportMode 不够:双语翻译后切回 translatedOnly,旧双语产物
          仍在 translatedText 里,含原文(ASS 双 Dialogue → 2N cue),与源配对会错位 */}
      {uploadMode === "single" && translatedText && exportMode === "translatedOnly" && !translatedTextBilingual && failedCount === 0 && (
        <BilingualReviewPanel sourceText={sourceText} sourceFormat={sourceFileType} translatedText={translatedText} translatedFormat={translatedTextExt} />
      )}
              </>
            ),
          },
          {
            key: "review",
            label: (
              <Space>
                <SearchOutlined />
                <Text strong>🔍 Kiểm duyệt & Soát lỗi Subtitle</Text>
              </Space>
            ),
            children: (
              <SubtitleReviewTab
                fileQueue={fileQueue}
                translationOutputs={translationOutputs}
              />
            ),
          },
        ]}
      />

      <MultiLanguageSettingsModal
        open={multiLangModalOpen}
        onClose={() => setMultiLangModalOpen(false)}
        targetLanguages={targetLanguages}
        setTargetLanguages={setTargetLanguages}
        setMultiLanguageMode={setMultiLanguageMode}
      />

      <SplitBilingualModal
        open={splitModalOpen}
        onClose={() => setSplitModalOpen(false)}
        sourceText={sourceText}
        fileName={multipleFiles[0]?.name || "subtitle.ass"}
        uploadMode={uploadMode}
        multipleFiles={multipleFiles}
        readFile={readFile}
        onTaskChange={setSplitTask}
      />

      <BilingualTranslateModal
        open={bilingualTranslateModalOpen}
        onClose={() => setBilingualTranslateModalOpen(false)}
        sourceText={sourceText}
        fileName={multipleFiles[0]?.name || "subtitle.ass"}
        contextAware={contextAware}
        uploadMode={uploadMode}
        multipleFiles={multipleFiles}
        readFile={readFile}
        onTaskChange={setBilingualTask}
      />

      <CharacterGraphModal
        open={characterGraphModalOpen}
        onClose={() => setCharacterGraphModalOpen(false)}
        sourceText={sourceText}
        fileName={multipleFiles[0]?.name || "subtitle.ass"}
      />

      <AssStyleDrawer
        open={assStyleOpen}
        onClose={() => setAssStyleOpen(false)}
        config={assStyle}
        preset={assPreset}
        customStyle={assCustomStyle}
        onChange={handleAssChange}
        isOriginalFirst={isOriginalFirst}
        sourceLang={sourceLanguage}
        targetLang={targetLanguage}
      />
    </>
  );
};

export default SubtitleTranslator;
