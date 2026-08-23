"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Select, Radio, Checkbox, Button, Flex, Typography, App, theme, Empty, Alert, Spin } from "antd";
import { useTranslations, useLocale } from "next-intl";
import {
  parseAssDialogueStyles,
  detectAssLanguageGroups,
  splitAssByStyles,
  mergeAssOutputs,
  filterSubLines,
  prepareAssForTranslation,
  restoreAssAfterTranslation,
  applyRemoveCharsToAssLines,
  assembleSubtitleOutput,
  ASS_STYLE_PRESETS,
} from "@/app/lib/translation/formats/subtitle";
import { transformSkippingSoftFilled } from "@/app/lib/translation/softFill";
import { splitFileName, describeError } from "@/app/utils";
import { useLanguageOptions, filterLanguageOption } from "@/app/components/languages";
import { useTranslationContext } from "@/app/components/TranslationContext";
import BatchDownloadResults, { type OutputItem } from "@/app/components/BatchDownloadResults";
import { extractCharacterGraphFromText } from "@/app/lib/translation/characterGraphService";

const { Text } = Typography;

export interface BackgroundTaskPayload {
  type: "bilingual" | "split";
  isProcessing: boolean;
  items: OutputItem[];
  zipFileName: string;
  onCancel: () => void;
}

interface BilingualTranslateModalProps {
  open: boolean;
  onClose: () => void;
  sourceText: string;
  fileName: string;
  /** <ctrl42>only SubtitleTranslator page holds this (useLocalStorage), passed externally. */
  contextAware: boolean;
  uploadMode: "single" | "multiple";
  multipleFiles: File[];
  readFile: (file: File, onSuccess: (text: string) => void, onError?: () => void) => void;
  onTaskChange?: (task: BackgroundTaskPayload | null) => void;
}

interface TrackLangConfig {
  sourceLang: string;
  targetLang: string;
}

// next-intl 的 locale 代码大部分跟 languages-data 的语言 value 直接同名(vi/ja/zh/...),
// 只有葡萄牙语这一条不一致 —— 路由用简写 "pt",语言表只有 "pt-br" 这一个具体变体。
const LOCALE_TO_LANGUAGE_CODE: Record<string, string> = { pt: "pt-br" };

const slugifyLabel = (label: string): string => {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9À-￿]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "translated";
};

/**
 * 双语 ASS「按轨道各自翻译」弹窗 —— Split Bilingual 的姐妹功能:Split 拆出单语
 * 文件让用户自己去翻译,这里把"拆 + 译"接成一步,并支持两条轨道各译到不同
 * 语言、合并回一份新的双语文件。
 *
 * 每条轨道的翻译复用 performTranslation(SubtitleTranslator.tsx)同一套管线
 * (filterSubLines → prepareAssForTranslation → translateBatch → 还原 → 装配),
 * 但不带页面级的进度条/实时行流/多文件记账 —— 这里最多两次顺序调用,一个
 * loading 态足够,接那整套反而是把强耦合的页面状态机拽进一个独立弹窗。
 */
const BilingualTranslateModal = ({ open, onClose, sourceText, fileName, contextAware, uploadMode, multipleFiles, readFile, onTaskChange }: BilingualTranslateModalProps) => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  const t = useTranslations("common");

  // Pre-evaluate static i18n labels synchronously during React render phase
  // to prevent next-intl dev warnings from triggering inside async event callbacks.
  const stepGraphExtractLabel = tSubtitle.has("stepGraphExtract")
    ? tSubtitle("stepGraphExtract")
    : "Bước 1/2: Đang phân tích Đồ thị quan hệ & xưng hô...";
  const stepTranslatingLabel = tSubtitle.has("stepTranslating")
    ? tSubtitle("stepTranslating")
    : "Bước 2/2: Đang dịch nội dung phụ đề...";
  const fileProcessFailedLabel = t.has("fileProcessFailed") ? t("fileProcessFailed") : "Xử lý tệp thất bại";
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { sourceOptions, targetOptions } = useLanguageOptions();
  const { translateBatch, translationMethod, removeChars, requestCancel, characterGraphEnabled, characterGraphProvider, getCharacterGraphConfig, getSelectedConfig } = useTranslationContext();
  const locale = useLocale();
  const defaultTargetLang = (() => {
    const code = LOCALE_TO_LANGUAGE_CODE[locale] ?? locale;
    return targetOptions.some((o) => o.value === code) ? code : "";
  })();

  const [styles, setStyles] = useState(() => parseAssDialogueStyles(sourceText));
  const [detection, setDetection] = useState(() => detectAssLanguageGroups(styles));
  const [trackConfigs, setTrackConfigs] = useState<Record<string, TrackLangConfig>>({});
  const [enabledTracks, setEnabledTracks] = useState<Record<string, boolean>>({});
  const [minorHandling, setMinorHandling] = useState<"keep" | "drop" | "translate">("keep");
  const [minorTargetLang, setMinorTargetLang] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [items, setItems] = useState<OutputItem[] | null>(null);
  const cancelRequestedRef = useRef(false);

  const handleCancel = useCallback(() => {
    cancelRequestedRef.current = true;
    requestCancel();
    setIsTranslating(false);
    setItems((prev) =>
      prev?.map((it) => (it.status === "processing" || it.status === "pending" ? { ...it, status: "error", errorMessage: t("cancelled") } : it)) ?? prev,
    );
  }, [requestCancel, t]);

  const readFileAsync = (file: File): Promise<string | null> => new Promise((resolve) => readFile(file, (text) => resolve(text), () => resolve(null)));

  const applyDetection = (parsed: ReturnType<typeof parseAssDialogueStyles>) => {
    const nextDetection = detectAssLanguageGroups(parsed);
    setStyles(parsed);
    setDetection(nextDetection);
    setTrackConfigs(Object.fromEntries(nextDetection.mainGroups.map((g) => [g.label, { sourceLang: "auto", targetLang: defaultTargetLang }])));
    setEnabledTracks(Object.fromEntries(nextDetection.mainGroups.map((g) => [g.label, true])));
    setMinorHandling("keep");
    setMinorTargetLang(defaultTargetLang);
  };

  useEffect(() => {
    if (items && items.length > 0) {
      const zipFileName = `${splitFileName((uploadMode === "single" ? fileName : multipleFiles[0]?.name) || "subtitle.ass", ".ass").nameWithoutExt}-translated.zip`;
      onTaskChange?.({
        type: "bilingual",
        isProcessing: isTranslating,
        items,
        zipFileName,
        onCancel: handleCancel,
      });
    } else {
      onTaskChange?.(null);
    }
  }, [items, isTranslating, fileName, multipleFiles, uploadMode, onTaskChange, handleCancel]);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && !isTranslating && !items) {
      if (uploadMode === "single") {
        applyDetection(parseAssDialogueStyles(sourceText));
      } else if (uploadMode === "multiple") {
        if (multipleFiles.length === 0) {
          setStyles([]);
          setDetection(detectAssLanguageGroups([]));
          setTrackConfigs({});
          setEnabledTracks({});
        } else {
          setIsLoadingPreview(true);
        }
      }
    }
  }

  // 批量模式:用第一个文件的内容代表整批做样式检测/轨道配置 —— readFile 引用
  // 每次渲染都变(useFileUpload 没有 useCallback),依赖它会导致每次渲染都重读
  // 文件,故意只依赖 open/uploadMode/首文件本身。
  useEffect(() => {
    if (!open || uploadMode !== "multiple") return;
    const first = multipleFiles[0];
    if (!first) return;
    readFile(
      first,
      (text) => {
        applyDetection(parseAssDialogueStyles(text));
        setIsLoadingPreview(false);
      },
      () => {
        setIsLoadingPreview(false);
        message.error(t("fileProcessFailed"));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uploadMode, multipleFiles[0]]);

  const setTrackConfig = (label: string, patch: Partial<TrackLangConfig>) => {
    setTrackConfigs((prev) => {
      const current: TrackLangConfig = prev[label] ?? { sourceLang: "auto", targetLang: "" };
      return { ...prev, [label]: { ...current, ...patch } };
    });
  };

  const activeGroups = detection.mainGroups.filter((g) => enabledTracks[g.label]);
  const allConfigured = activeGroups.length > 0 && activeGroups.every((g) => trackConfigs[g.label]?.sourceLang && trackConfigs[g.label]?.targetLang);
  const activeTargets = activeGroups.map((g) => trackConfigs[g.label]?.targetLang).filter(Boolean);
  // 两条选中轨道译到同一门语言 = 同一时间点会出现两条内容不同却"同语言"的
  // 字幕(它们本是同一句台词的两种语言版本,译到同一语言就变成重复/冲突)——
  // 用勾选框本身就能避免:想只留一条,取消另一条的勾选即可,不需要额外再选一次"主轨道"。
  const hasTargetCollision = new Set(activeTargets).size !== activeTargets.length;
  const canTranslate = allConfigured && !hasTargetCollision && !isTranslating && (minorHandling !== "translate" || !!minorTargetLang);

  const toggleTrackEnabled = (label: string, checked: boolean) => {
    setEnabledTracks((prev) => {
      const next = { ...prev, [label]: checked };
      // 不允许全部取消勾选 —— 至少要留一条轨道才有东西可译,否则静默拒绝这次改动。
      if (Object.values(next).every((v) => !v)) return prev;
      return next;
    });
  };

  // 单条轨道的完整"拆 + 译"——复用 performTranslation 同款管线,但只返回译好的
  // 单语 ASS 字符串,不写任何页面状态。sourceText/fileNameForMeta 显式传入(而不是
  // 直接闭包用 modal 的 sourceText prop):批量模式下每个文件都要各自调用一次,
  // 单文件模式复用同一个函数只是把 prop 原样传进来。
  const translateTrack = async (fileText: string, fileNameForMeta: string, trackStyles: string[], sourceLang: string, targetLang: string): Promise<string> => {
    if (cancelRequestedRef.current) throw new Error("cancelled");
    const part = splitAssByStyles(fileText, [{ label: "track", styles: trackStyles }])[0];
    const lines = (part?.content ?? "").split(/\r\n|\r|\n/);
    const { contentLines, contentIndices, assContentStartIndex } = filterSubLines(lines, "ass");
    const { cleanLines, tagMaps } = prepareAssForTranslation(contentLines);
    const softFilled = new Set<number>();
    const rawTranslated = await translateBatch(
      cleanLines,
      translationMethod,
      targetLang,
      0,
      1,
      contextAware ? "subtitle" : undefined,
      { lineNumbers: contentIndices.map((i) => i + 1), fileName: fileNameForMeta, collectSoftFilled: softFilled },
      false,
      sourceLang,
    );
    if (cancelRequestedRef.current) throw new Error("cancelled");
    const cleaned = transformSkippingSoftFilled(rawTranslated, softFilled, (ls) => applyRemoveCharsToAssLines(ls, removeChars));
    const translatedLines = restoreAssAfterTranslation(cleaned, tagMaps);
    return assembleSubtitleOutput({
      lines,
      contentIndices,
      contentLines,
      translatedLines,
      fileType: "ass",
      assContentStartIndex,
      tagMaps,
      isBilingual: false,
      isOriginalFirst: true,
      bilingualFormat: "ass",
      assNativeRebuild: false,
      assStyle: ASS_STYLE_PRESETS.default,
      sourceLanguage: sourceLang,
      exportLang: targetLang,
      softFilledIndices: softFilled,
    });
  };

  const translateOneFile = async (fileText: string, sourceFileName: string, onTrackStart: (trackLabel: string) => void): Promise<{ fileName: string; content: string }> => {
    const parts: string[] = [];
    const langLabels: string[] = [];
    for (const g of activeGroups) {
      if (cancelRequestedRef.current) throw new Error("cancelled");
      const cfg = trackConfigs[g.label];
      onTrackStart(g.label);
      parts.push(await translateTrack(fileText, sourceFileName, g.styles, cfg.sourceLang, cfg.targetLang));
      langLabels.push(cfg.targetLang);
    }
    const outputLangLabel = langLabels.join("-");

    if (detection.minorStyles.length > 0) {
      const minorStyleNames = detection.minorStyles.map((s) => s.name);
      if (minorHandling === "translate") {
        if (cancelRequestedRef.current) throw new Error("cancelled");
        onTrackStart(tSubtitle("bilingualTranslateMinorLabel", { styles: minorStyleNames.join(", ") }));
        parts.push(await translateTrack(fileText, sourceFileName, minorStyleNames, "auto", minorTargetLang));
      } else if (minorHandling === "keep") {
        const minorPart = splitAssByStyles(fileText, [{ label: "minor", styles: minorStyleNames }])[0];
        if (minorPart) parts.push(minorPart.content);
      }
    }

    const merged = parts.length > 1 ? mergeAssOutputs(parts) : parts[0];
    const { nameWithoutExt, ext } = splitFileName(sourceFileName, ".ass");
    return { fileName: `${nameWithoutExt}.${slugifyLabel(outputLangLabel)}${ext}`, content: merged };
  };

  const handleTranslate = async () => {
    const sourceFiles = uploadMode === "single" ? [{ name: fileName }] : multipleFiles.map((f) => ({ name: f.name }));
    const outputLangLabel = activeGroups.map((g) => trackConfigs[g.label].targetLang).join("-");
    const initialItems: OutputItem[] = sourceFiles.map((sf) => {
      const { nameWithoutExt, ext } = splitFileName(sf.name, ".ass");
      return { key: sf.name, fileName: `${nameWithoutExt}.${slugifyLabel(outputLangLabel)}${ext}`, status: "pending" as const };
    });
    setItems(initialItems);
    setIsTranslating(true);
    cancelRequestedRef.current = false;

    const updateItem = (key: string, patch: Partial<OutputItem>) =>
      setItems((prev) => prev?.map((it) => (it.key === key ? { ...it, ...patch } : it)) ?? prev);

    const totalSteps = characterGraphEnabled ? 2 : 1;
    let succeeded = 0;
    for (let i = 0; i < sourceFiles.length; i++) {
      if (cancelRequestedRef.current) break;
      const sf = sourceFiles[i];

      updateItem(sf.name, {
        status: "processing",
        step: { current: 1, total: totalSteps, name: characterGraphEnabled ? stepGraphExtractLabel : stepTranslatingLabel },
        progressLabel: characterGraphEnabled ? stepGraphExtractLabel : undefined,
      });
      const text = uploadMode === "single" ? sourceText : await readFileAsync(multipleFiles[i]);
      if (cancelRequestedRef.current) break;
      if (text === null) {
        updateItem(sf.name, { status: "error", errorMessage: fileProcessFailedLabel });
        continue;
      }
      try {
        if (characterGraphEnabled) {
          const cgProvider = characterGraphProvider || "gemini";
          const cgConfig = getCharacterGraphConfig ? getCharacterGraphConfig(cgProvider) : { apiKey: "", model: "" };
          await extractCharacterGraphFromText(text, {
            sourceFileName: sf.name,
            provider: cgProvider,
            apiKey: cgConfig.apiKey,
            model: cgConfig.model,
            endpoint: cgConfig.url,
          });
          if (cancelRequestedRef.current) break;
        }

        updateItem(sf.name, {
          status: "processing",
          step: { current: totalSteps, total: totalSteps, name: stepTranslatingLabel },
        });

        const { fileName: outFileName, content } = await translateOneFile(text, sf.name, (track) =>
          updateItem(sf.name, {
            step: { current: totalSteps, total: totalSteps, name: tSubtitle("stepTranslating") },
            progressLabel: tSubtitle("bilingualTranslateProgress", { track }),
          }),
        );
        if (cancelRequestedRef.current) break;
        updateItem(sf.name, { status: "done", content, fileName: outFileName, progressLabel: undefined, step: undefined });
        succeeded++;
      } catch (error) {
        if (cancelRequestedRef.current) {
          updateItem(sf.name, { status: "error", errorMessage: t("cancelled") });
          break;
        }
        console.error(error);
        updateItem(sf.name, { status: "error", errorMessage: describeError(error, t) });
      }
    }
    setIsTranslating(false);
    if (!cancelRequestedRef.current && succeeded < sourceFiles.length) {
      message.warning(tSubtitle("bilingualTranslateBatchPartial", { succeeded, total: sourceFiles.length }));
    }
  };

  return (
    <Modal open={open} onCancel={onClose} title={tSubtitle("bilingualTranslateTitle")} width={640} footer={null}>
      {items ? (
        <BatchDownloadResults
          items={items}
          isProcessing={isTranslating}
          zipFileName={`${splitFileName((uploadMode === "single" ? fileName : multipleFiles[0]?.name) || "subtitle.ass", ".ass").nameWithoutExt}-translated.zip`}
          onCancel={handleCancel}
          onMinimize={onClose}
          onDone={() => {
            setItems(null);
            onTaskChange?.(null);
            onClose();
          }}
        />
      ) : isLoadingPreview ? (
        <Flex justify="center" style={{ padding: "32px 0" }}>
          <Spin />
        </Flex>
      ) : detection.mainGroups.length <= 1 ? (
        <Empty description={styles.length === 0 ? tSubtitle("splitNoStyles") : tSubtitle("bilingualTranslateSingleLanguage")} />
      ) : (
        <Flex vertical gap="middle">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tSubtitle("bilingualTranslateHint")}
          </Text>

          {uploadMode === "multiple" && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tSubtitle("batchBasedOnFirstFile", { fileName: multipleFiles[0]?.name ?? "", total: multipleFiles.length })}
            </Text>
          )}

          <Flex vertical gap="small">
            {detection.mainGroups.map((g) => {
              const cfg = trackConfigs[g.label];
              const enabled = enabledTracks[g.label] ?? true;
              return (
                <Flex
                  key={g.label}
                  vertical
                  gap={4}
                  style={{ padding: "8px 12px", borderRadius: token.borderRadiusLG, background: token.colorFillTertiary, opacity: enabled ? 1 : 0.6 }}>
                  <Checkbox checked={enabled} onChange={(e) => toggleTrackEnabled(g.label, e.target.checked)} disabled={isTranslating}>
                    <Text strong>
                      {g.label} · {tSubtitle("splitLineCount", { count: g.count })}
                    </Text>
                  </Checkbox>
                  <Flex gap="small" wrap>
                    <Select
                      style={{ flex: 1, minWidth: 180 }}
                      showSearch
                      placeholder={tSubtitle("bilingualTranslateSourceLabel")}
                      options={sourceOptions}
                      value={cfg?.sourceLang || undefined}
                      onChange={(v) => setTrackConfig(g.label, { sourceLang: v })}
                      filterOption={(input, option) => filterLanguageOption({ input, option })}
                      disabled={isTranslating || !enabled}
                    />
                    <Select
                      style={{ flex: 1, minWidth: 180 }}
                      showSearch
                      placeholder={tSubtitle("bilingualTranslateTargetLabel")}
                      options={targetOptions}
                      value={cfg?.targetLang || undefined}
                      onChange={(v) => setTrackConfig(g.label, { targetLang: v })}
                      filterOption={(input, option) => filterLanguageOption({ input, option })}
                      disabled={isTranslating || !enabled}
                    />
                  </Flex>
                </Flex>
              );
            })}
          </Flex>

          {detection.minorStyles.length > 0 && (
            <Flex vertical gap={4}>
              <Text strong>{tSubtitle("bilingualTranslateMinorLabel", { styles: detection.minorStyles.map((s) => s.name).join(", ") })}</Text>
              <Radio.Group
                value={minorHandling}
                onChange={(e) => setMinorHandling(e.target.value)}
                disabled={isTranslating}
                options={[
                  { label: tSubtitle("bilingualTranslateMinorKeep"), value: "keep" },
                  { label: tSubtitle("bilingualTranslateMinorTranslate"), value: "translate" },
                  { label: tSubtitle("bilingualTranslateMinorDrop"), value: "drop" },
                ]}
              />
              {minorHandling === "translate" && (
                <Select
                  style={{ maxWidth: 280 }}
                  showSearch
                  placeholder={tSubtitle("bilingualTranslateTargetLabel")}
                  options={targetOptions}
                  value={minorTargetLang || undefined}
                  onChange={(v) => setMinorTargetLang(v)}
                  filterOption={(input, option) => filterLanguageOption({ input, option })}
                  disabled={isTranslating}
                />
              )}
            </Flex>
          )}

          {hasTargetCollision && <Alert type="warning" showIcon title={tSubtitle("bilingualTranslateTargetCollision")} />}

          <Flex justify="end" align="center" gap="small">
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button type="primary" onClick={handleTranslate} loading={isTranslating} disabled={!canTranslate}>
              {tSubtitle("bilingualTranslateConfirm")}
            </Button>
          </Flex>
        </Flex>
      )}
    </Modal>
  );
};

export default BilingualTranslateModal;
