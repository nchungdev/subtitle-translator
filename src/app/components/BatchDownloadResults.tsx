"use client";

import { useState } from "react";
import { Button, Checkbox, Flex, Typography, App, theme, Spin, Tag } from "antd";
import { DownloadOutlined, FileZipOutlined, ClockCircleOutlined, CloseCircleOutlined, DownOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import JSZip from "jszip";
import { downloadFile } from "@/app/utils";
import { delay } from "@/app/lib/translation/retry";

const { Text } = Typography;

export type OutputStatus = "pending" | "processing" | "done" | "error";

export interface OutputItem {
  /** Stable identity across re-renders while the run is in progress (e.g. source file name, or `${sourceFile}::${group}`). */
  key: string;
  fileName: string;
  status: OutputStatus;
  /** Shown next to the spinner while status === "processing" (e.g. which track is being translated right now). */
  progressLabel?: string;
  step?: {
    current: number;
    total: number;
    name?: string;
  };
  /** Present once status === "done". */
  content?: string;
  errorMessage?: string;
}

interface BatchDownloadResultsProps {
  items: OutputItem[];
  /** Whether the producing loop is still running — swaps the footer between Cancel and Close. */
  isProcessing: boolean;
  zipFileName: string;
  onCancel?: () => void;
  onDone: () => void;
  onMinimize?: () => void;
}

/**
 * 处理结果清单 —— 取代"处理完就自动 downloadFile()"。浏览器把短时间内连续
 * 多次触发的下载当成可疑行为,第二个起就可能被静默拦截(用户只会看到"批量
 * 功能突然不能用了"),所以不管单文件还是批量都不自动下载:全部收集到内存,
 * 交给用户自己驱动 —— 单个下载(用户点一次触发一次,不会被拦)或打包成一个
 * zip 一次性下载(物理上就只有一次 downloadFile 调用)。
 *
 * items 在处理过程中就已经挂出来(pending → processing → done/error),不是
 * 等全部跑完才出现 —— 用户能看到整体进度,也能在还有文件没处理完时就先把
 * 已经好了的下载走。
 */
const BatchDownloadResults = ({ items, isProcessing, zipFileName, onCancel, onDone, onMinimize }: BatchDownloadResultsProps) => {
  const tSubtitle = useTranslations("SubtitleTranslator");
  const t = useTranslations("common");
  const { message } = App.useApp();
  const { token } = theme.useToken();
  // 存"取消选中"而不是"选中"集合:done 的 item 会随处理推进不断增加,新完成
  // 的默认视为已选(等价于"全选",且不需要在 items 变化时另开一个 effect 去同步)。
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());
  const [isDownloading, setIsDownloading] = useState(false);

  const doneItems = items.filter((it) => it.status === "done");
  const selectedItems = doneItems.filter((it) => !deselected.has(it.key));
  const allSelected = doneItems.length > 0 && selectedItems.length === doneItems.length;

  const toggleAll = (checked: boolean) => setDeselected(checked ? new Set() : new Set(doneItems.map((it) => it.key)));
  const toggleOne = (key: string, checked: boolean) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleDownloadOne = (item: OutputItem) => {
    if (item.content !== undefined) void downloadFile(item.content, item.fileName);
  };

  const handleDownloadSelected = async () => {
    setIsDownloading(true);
    try {
      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        if (item.content !== undefined) await downloadFile(item.content, item.fileName);
        if (i < selectedItems.length - 1) await delay(300);
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadZip = async () => {
    if (selectedItems.length === 0) {
      message.warning(tSubtitle("batchResultsNoneSelected"));
      return;
    }
    setIsDownloading(true);
    try {
      const zip = new JSZip();
      for (const item of selectedItems) if (item.content !== undefined) zip.file(item.fileName, item.content);
      const blob = await zip.generateAsync({ type: "blob" });
      await downloadFile(blob, zipFileName);
    } finally {
      setIsDownloading(false);
    }
  };

  const statusRow = (item: OutputItem) => {
    if (item.status === "pending") {
      return (
        <Flex align="center" gap={8}>
          <ClockCircleOutlined style={{ color: token.colorTextTertiary }} />
          <Text type="secondary" ellipsis style={{ maxWidth: 360 }}>
            {item.fileName}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tSubtitle("batchResultsPending")}
          </Text>
        </Flex>
      );
    }
    if (item.status === "processing") {
      return (
        <Flex align="center" gap={8}>
          <Spin size="small" />
          {item.step && (
            <Tag color="processing" style={{ margin: 0, fontSize: 11, padding: "0 6px" }}>
              Bước {item.step.current}/{item.step.total}
            </Tag>
          )}
          <Text ellipsis style={{ maxWidth: 300 }}>
            {item.fileName}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item.progressLabel || tSubtitle("batchResultsProcessing")}
          </Text>
        </Flex>
      );
    }
    if (item.status === "error") {
      return (
        <Flex align="center" gap={8}>
          <CloseCircleOutlined style={{ color: token.colorError }} />
          <Text type="danger" ellipsis style={{ maxWidth: 360 }}>
            {item.fileName}
          </Text>
          <Text type="danger" style={{ fontSize: 12 }}>
            {item.errorMessage || tSubtitle("batchResultsErrorGeneric")}
          </Text>
        </Flex>
      );
    }
    return (
      <Checkbox checked={!deselected.has(item.key)} onChange={(e) => toggleOne(item.key, e.target.checked)}>
        <Text ellipsis style={{ maxWidth: 360 }}>
          {item.fileName}
        </Text>
      </Checkbox>
    );
  };

  return (
    <Flex vertical gap="middle">
      <Flex justify="space-between" align="center">
        <Checkbox
          checked={allSelected}
          indeterminate={selectedItems.length > 0 && !allSelected}
          disabled={doneItems.length === 0}
          onChange={(e) => toggleAll(e.target.checked)}>
          {tSubtitle("batchResultsSelectAll")}
        </Checkbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {tSubtitle("batchResultsSelectedCount", { selected: selectedItems.length, total: items.length })}
        </Text>
      </Flex>

      <Flex vertical gap={4} style={{ maxHeight: 320, overflowY: "auto" }}>
        {items.map((item) => (
          <Flex
            key={item.key}
            align="center"
            justify="space-between"
            gap="small"
            style={{ padding: "6px 10px", borderRadius: token.borderRadiusLG, background: token.colorFillTertiary }}>
            {statusRow(item)}
            {item.status === "done" && (
              <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownloadOne(item)} aria-label={tSubtitle("batchResultsDownloadOne")} />
            )}
          </Flex>
        ))}
      </Flex>

      <Flex justify="end" gap="small">
        {onMinimize && (
          <Button icon={<DownOutlined />} onClick={onMinimize}>
            {tSubtitle("runInBackground")}
          </Button>
        )}
        {isProcessing ? (
          <Button onClick={onCancel}>{t("cancel")}</Button>
        ) : (
          <Button onClick={onDone}>{tSubtitle("batchResultsClose")}</Button>
        )}
        <Button onClick={handleDownloadSelected} loading={isDownloading} disabled={selectedItems.length === 0}>
          {tSubtitle("batchResultsDownloadSelected")}
        </Button>
        <Button type="primary" icon={<FileZipOutlined />} onClick={handleDownloadZip} loading={isDownloading} disabled={selectedItems.length === 0}>
          {tSubtitle("batchResultsDownloadZip")}
        </Button>
      </Flex>
    </Flex>
  );
};

export default BatchDownloadResults;
