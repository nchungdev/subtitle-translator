"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Input, Button, Flex, Checkbox, Typography, App, theme, Empty, Alert, Collapse, Spin } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import {
  parseAssDialogueStyles,
  detectAssLanguageGroups,
  splitAssByStyles,
  type AssSplitGroup,
  type AssLanguageDetection,
} from "@/app/lib/translation/formats/subtitle";
import { splitFileName } from "@/app/utils";
import BatchDownloadResults, { type OutputItem } from "@/app/components/BatchDownloadResults";
import type { BackgroundTaskPayload } from "@/app/components/BilingualTranslateModal";

const { Text } = Typography;

interface SplitBilingualModalProps {
  open: boolean;
  onClose: () => void;
  sourceText: string;
  fileName: string;
  uploadMode: "single" | "multiple";
  multipleFiles: File[];
  readFile: (file: File, onSuccess: (text: string) => void, onError?: () => void) => void;
  onTaskChange?: (task: BackgroundTaskPayload | null) => void;
}

// 文件名不接受任意字符 —— 组名转输出文件名的后缀段,非字母数字一律折成 "-"。
const slugifyLabel = (label: string): string => {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9À-￿]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "split";
};

const EMPTY_DETECTION: AssLanguageDetection = { mainGroups: [], minorStyles: [] };

// 按检测结果 + "是否并入次要样式"重建分组 —— 次要样式(OP/ED 歌词、STAFF 等)
// 默认塞进每一个主语言分组,让用户不用逐个样式手动勾选就能拿到"完整的单语文件"
// (而不是只有正片对白、缺了片头曲/职员表的半成品)。
const buildGroupsFromDetection = (detection: AssLanguageDetection, includeMinor: boolean): AssSplitGroup[] => {
  const minorNames = detection.minorStyles.map((s) => s.name);
  return detection.mainGroups.map((g) => ({
    label: g.label,
    styles: includeMinor ? [...g.styles, ...minorNames] : [...g.styles],
  }));
};

/**
 * 双语 ASS 拆分单语弹窗。核心痛点:真实字幕文件的 Style 表很少只有 2 条 ——
 * 正常位/上移位各一份、OP/ED 歌词、STAFF 名单、杂项贴纸都各占一个 Style,
 * 用户面对 7、8 个样式会问"不是只有两种语言吗,怎么列出这么多"。
 * detectAssLanguageGroups 按台词行数把它们收成"N 种主语言 + 一撮次要样式",
 * 弹窗默认直接展示这个结论并预置好分组;仍需要手动改样式归属的场景
 * (语言判断跑偏、真的要拆出第三条轨道等)折进下方"高级"折叠区,复用原有的
 * 逐样式勾选表格。
 */
const SplitBilingualModal = ({ open, onClose, sourceText, fileName, uploadMode, multipleFiles, readFile, onTaskChange }: SplitBilingualModalProps) => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  const t = useTranslations("common");
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const splitTitle = tSubtitle.has("splitTitle") ? tSubtitle("splitTitle") : "Tách phụ đề song ngữ";
  const splitHint = tSubtitle.has("splitHint") ? tSubtitle("splitHint") : "Tệp ASS này chứa nhiều kiểu kiểu dáng thoại.";
  const splitGroupsLabel = tSubtitle.has("splitGroupsLabel") ? tSubtitle("splitGroupsLabel") : "Nhóm xuất";
  const splitAddGroup = tSubtitle.has("splitAddGroup") ? tSubtitle("splitAddGroup") : "Thêm nhóm";
  const splitNoStyles = tSubtitle.has("splitNoStyles") ? tSubtitle("splitNoStyles") : "Không tìm thấy kiểu dáng thoại nào.";

  const [styles, setStyles] = useState(() => parseAssDialogueStyles(sourceText));
  const [detection, setDetection] = useState<AssLanguageDetection>(EMPTY_DETECTION);
  const [groups, setGroups] = useState<AssSplitGroup[]>([]);
  const [includeMinor, setIncludeMinor] = useState(true);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [items, setItems] = useState<OutputItem[] | null>(null);
  const cancelRequestedRef = useRef(false);

  const handleCancel = useCallback(() => {
    cancelRequestedRef.current = true;
    setIsSplitting(false);
    setItems((prev) =>
      prev?.map((it) => (it.status === "processing" || it.status === "pending" ? { ...it, status: "error", errorMessage: t("cancelled") } : it)) ?? prev,
    );
  }, [t]);

  const readFileAsync = (file: File): Promise<string | null> => new Promise((resolve) => readFile(file, (text) => resolve(text), () => resolve(null)));

  const applyDetection = (parsed: ReturnType<typeof parseAssDialogueStyles>) => {
    const det = detectAssLanguageGroups(parsed);
    setStyles(parsed);
    setDetection(det);
    setIncludeMinor(true);
    setGroups(buildGroupsFromDetection(det, true));
  };

  useEffect(() => {
    if (items && items.length > 0) {
      const zipFileName = `${splitFileName((uploadMode === "single" ? fileName : multipleFiles[0]?.name) || "subtitle.ass", ".ass").nameWithoutExt}-split.zip`;
      onTaskChange?.({
        type: "split",
        isProcessing: isSplitting,
        items,
        zipFileName,
        onCancel: handleCancel,
      });
    } else {
      onTaskChange?.(null);
    }
  }, [items, isSplitting, fileName, multipleFiles, uploadMode, onTaskChange, handleCancel]);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && !isSplitting && !items) {
      if (uploadMode === "single") {
        applyDetection(parseAssDialogueStyles(sourceText));
      } else if (uploadMode === "multiple") {
        if (multipleFiles.length === 0) {
          setStyles([]);
          setDetection(EMPTY_DETECTION);
          setGroups([]);
        } else {
          setIsLoadingPreview(true);
        }
      }
    }
  }

  // 批量模式:用第一个文件的内容代表整批做样式检测/分组配置 —— 弹窗打开时
  // 读一次即可,readFile 引用每次渲染都变(useFileUpload 里没有 useCallback),
  // 依赖它会导致每次渲染都重新读文件,故意只依赖 open/uploadMode/首文件本身。
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

  const handleToggleIncludeMinor = (checked: boolean) => {
    setIncludeMinor(checked);
    const minorNames = new Set(detection.minorStyles.map((s) => s.name));
    setGroups((prev) =>
      prev.map((g) => {
        const withoutMinor = g.styles.filter((s) => !minorNames.has(s));
        return { ...g, styles: checked ? [...withoutMinor, ...minorNames] : withoutMinor };
      })
    );
  };

  const toggleStyleInGroup = (groupIndex: number, styleName: string, checked: boolean) => {
    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIndex) return g;
        const styles = checked ? [...g.styles, styleName] : g.styles.filter((s) => s !== styleName);
        return { ...g, styles };
      })
    );
  };

  const handleAddGroup = () => {
    setGroups((prev) => [...prev, { label: String(prev.length + 1), styles: [] }]);
  };

  const handleRemoveGroup = (index: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLabelChange = (index: number, label: string) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, label } : g)));
  };

  const unassignedStyles = styles.filter((s) => !groups.some((g) => g.styles.includes(s.name)));

  const handleSplit = async () => {
    const activeGroups = groups.filter((g) => g.styles.length > 0);
    if (activeGroups.length === 0) {
      message.warning(tSubtitle("splitNoStyleSelected"));
      return;
    }
    const seenLabels = new Set<string>();
    for (const g of activeGroups) {
      const slug = slugifyLabel(g.label);
      if (seenLabels.has(slug)) {
        message.warning(tSubtitle("splitDuplicateLabel"));
        return;
      }
      seenLabels.add(slug);
    }

    // 不管单文件还是批量,处理完都不再自动下载 —— 统一走"先挂出结果列表,
    // 用户自己驱动下载"的路径(单文件此前是立刻触发 downloadFile,浏览器会
    // 弹原生下载提示,用户反馈希望能先看完再决定;批量本来就是这个流程,
    // 现在两条路径合成一条,顺带去掉了"单文件不能取消"的特殊分支)。
    const sourceFiles = uploadMode === "single" ? [{ name: fileName }] : multipleFiles.map((f) => ({ name: f.name }));
    const initialItems: OutputItem[] = sourceFiles.flatMap((sf) => {
      const { nameWithoutExt, ext } = splitFileName(sf.name, ".ass");
      return activeGroups.map((g) => ({
        key: `${sf.name}::${g.label}`,
        fileName: `${nameWithoutExt}.${slugifyLabel(g.label)}${ext}`,
        status: "pending" as const,
      }));
    });
    setItems(initialItems);
    setIsSplitting(true);
    cancelRequestedRef.current = false;

    const updateItems = (keys: string[], patch: Partial<OutputItem>) =>
      setItems((prev) => prev?.map((it) => (keys.includes(it.key) ? { ...it, ...patch } : it)) ?? prev);

    let succeeded = 0;
    for (let i = 0; i < sourceFiles.length; i++) {
      if (cancelRequestedRef.current) break;
      const sf = sourceFiles[i];
      const keys = activeGroups.map((g) => `${sf.name}::${g.label}`);
      updateItems(keys, { status: "processing" });
      const text = uploadMode === "single" ? sourceText : await readFileAsync(multipleFiles[i]);
      if (text === null) {
        updateItems(keys, { status: "error", errorMessage: t("fileProcessFailed") });
        continue;
      }
      try {
        const outputs = splitAssByStyles(text, activeGroups);
        for (const { label, content } of outputs) updateItems([`${sf.name}::${label}`], { status: "done", content });
        succeeded++;
      } catch {
        updateItems(keys, { status: "error" });
      }
    }
    setIsSplitting(false);
    if (succeeded < sourceFiles.length) message.warning(tSubtitle("splitBatchPartial", { succeeded, total: sourceFiles.length }));
  };

  const manualGrid = (
    <Flex vertical gap="middle">
      <Text type="secondary" style={{ fontSize: 12 }}>
        {splitHint}
      </Text>

      <Flex vertical gap="small">
        {styles.map((style) => (
          <Flex
            key={style.name}
            align="center"
            gap="small"
            wrap
            style={{ padding: "8px 12px", borderRadius: token.borderRadiusLG, background: token.colorFillTertiary }}>
            <Flex vertical style={{ minWidth: 160, flex: "1 1 200px" }}>
              <Text strong>{style.name}</Text>
              <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                {style.sampleText || "—"} · {tSubtitle.has("splitLineCount") ? tSubtitle("splitLineCount", { count: style.dialogueCount }) : `${style.dialogueCount} lines`}
              </Text>
            </Flex>
            <Flex gap="middle" wrap>
              {groups.map((g, gi) => (
                <Checkbox key={gi} checked={g.styles.includes(style.name)} onChange={(e) => toggleStyleInGroup(gi, style.name, e.target.checked)}>
                  {g.label || `#${gi + 1}`}
                </Checkbox>
              ))}
            </Flex>
          </Flex>
        ))}
      </Flex>

      <Flex vertical gap="small">
        <Text strong>{splitGroupsLabel}</Text>
        <Flex gap="small" wrap>
          {groups.map((g, i) => (
            <Flex key={i} gap={4} align="center">
              <Input
                value={g.label}
                onChange={(e) => handleLabelChange(i, e.target.value)}
                placeholder={tSubtitle.has("splitGroupPlaceholder") ? tSubtitle("splitGroupPlaceholder", { index: i + 1 }) : `Group ${i + 1}`}
                style={{ width: 140 }}
              />
              {groups.length > 1 && <Button icon={<DeleteOutlined />} onClick={() => handleRemoveGroup(i)} aria-label={tSubtitle.has("splitRemoveGroup") ? tSubtitle("splitRemoveGroup") : "Remove group"} />}
            </Flex>
          ))}
          <Button icon={<PlusOutlined />} onClick={handleAddGroup}>
            {splitAddGroup}
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );

  return (
    <Modal open={open} onCancel={onClose} title={splitTitle} width={640} footer={null}>
      {items ? (
        <BatchDownloadResults
          items={items}
          isProcessing={isSplitting}
          zipFileName={`${splitFileName((uploadMode === "single" ? fileName : multipleFiles[0]?.name) || "subtitle.ass", ".ass").nameWithoutExt}-split.zip`}
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
      ) : styles.length === 0 ? (
        <Empty description={splitNoStyles} />
      ) : (
        <Flex vertical gap="middle">
          {uploadMode === "multiple" && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tSubtitle("batchBasedOnFirstFile", { fileName: multipleFiles[0]?.name ?? "", total: multipleFiles.length })}
            </Text>
          )}

          {detection.mainGroups.length <= 1 ? (
            <Alert
              type="info"
              showIcon
              title={
                detection.mainGroups.length === 1
                  ? tSubtitle("splitSingleLanguage", { label: detection.mainGroups[0].label, count: detection.mainGroups[0].count })
                  : tSubtitle("splitNoStyles")
              }
            />
          ) : (
            <>
              <Text>{tSubtitle("splitDetectedSummary", { count: detection.mainGroups.length })}</Text>
              <Flex vertical gap={4}>
                {detection.mainGroups.map((g) => (
                  <Text key={g.label}>
                    <Text strong>{g.label}</Text> · {tSubtitle("splitLineCount", { count: g.count })}
                  </Text>
                ))}
              </Flex>
              {detection.minorStyles.length > 0 && (
                <Checkbox checked={includeMinor} onChange={(e) => handleToggleIncludeMinor(e.target.checked)}>
                  {tSubtitle("splitIncludeMinor", { styles: detection.minorStyles.map((s) => s.name).join(", ") })}
                </Checkbox>
              )}
            </>
          )}

          {unassignedStyles.length > 0 && (
            <Text type="warning" style={{ fontSize: 12 }}>
              {tSubtitle("splitUnassignedWarning", { styles: unassignedStyles.map((s) => s.name).join(", ") })}
            </Text>
          )}

          <Collapse ghost size="small" items={[{ key: "manual", label: tSubtitle("splitAdvancedTitle"), children: manualGrid }]} />

          <Flex justify="end" align="center" gap="small">
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button type="primary" onClick={handleSplit} loading={isSplitting}>
              {tSubtitle("splitConfirm")}
            </Button>
          </Flex>
        </Flex>
      )}
    </Modal>
  );
};

export default SplitBilingualModal;
