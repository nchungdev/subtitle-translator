"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  Card,
  Row,
  Col,
  Space,
  Button,
  Select,
  Checkbox,
  Table,
  Tag,
  Input,
  Typography,
  Progress,
  App,
  Tooltip,
  Badge,
  Upload,
  Flex,
  Divider,
  theme,
} from "antd";
import {
  SearchOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  SaveOutlined,
  CheckOutlined,
  CloseOutlined,
  UploadOutlined,
  FileTextOutlined,
  ReloadOutlined,
  CloseCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { auditSubtitleCues, SubtitleReviewIssue } from "@/app/lib/translation/services/reviewService";
import JSZip from "jszip";
import { parseCues, replaceCueText } from "@/app/[locale]/subtitleCues";
import { saveFileToDiskCache } from "@/app/lib/storage/fileDiskCache";
import { downloadFile } from "@/app/utils";

const { Text, Title, Paragraph } = Typography;

export interface FileQueueItemForReview {
  id: string;
  fileName: string;
  file: File;
  status: "pending" | "translating" | "done" | "error";
  inputMd5?: string;
  cachedFileName?: string;
}

export interface SubtitleReviewTabProps {
  fileQueue: FileQueueItemForReview[];
  translationOutputs: Array<{ key: string; fileName: string; status: "done" | "error"; content?: string }>;
}

export const SubtitleReviewTab: React.FC<SubtitleReviewTabProps> = ({ fileQueue, translationOutputs }) => {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const {
    translationMethod,
    getSelectedConfig,
    movieSynopsis,
    characterGraphPromptBlock,
    targetLanguage,
  } = useTranslationContext();

  const [selectedFileId, setSelectedFileId] = useState<string>("");
  
  // Custom uploaded files if user doesn't use fileQueue
  const [customSourceText, setCustomSourceText] = useState<string>("");
  const [customDraftText, setCustomDraftText] = useState<string>("");
  const [customSourceFileName, setCustomSourceFileName] = useState<string>("");
  const [customDraftFileName, setCustomDraftFileName] = useState<string>("");
  const [customFileName, setCustomFileName] = useState<string>("subtitle.ass");
  const [showLocalUploadPanel, setShowLocalUploadPanel] = useState<boolean>(false);

  const [localSourceMap, setLocalSourceMap] = useState<Map<string, { name: string; text: string }>>(new Map());
  const [localDraftMap, setLocalDraftMap] = useState<Map<string, { name: string; text: string }>>(new Map());

  const handleUploadCustomSource = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setLocalSourceMap((prev) => {
        const next = new Map(prev);
        next.set(file.name, { name: file.name, text });
        return next;
      });
      setCustomSourceText(text);
      setCustomSourceFileName(file.name);
      setCustomFileName(file.name);
      setSelectedFileId("custom_local");
    };
    reader.readAsText(file);
    return false;
  };

  const handleUploadCustomDraft = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || "";
      setLocalDraftMap((prev) => {
        const next = new Map(prev);
        next.set(file.name, { name: file.name, text });
        return next;
      });
      setCustomDraftText(text);
      setCustomDraftFileName(file.name);
      setSelectedFileId("custom_local");
    };
    reader.readAsText(file);
    return false;
  };

  // Review options
  const [checkTerminology, setCheckTerminology] = useState<boolean>(true);
  const [checkGrammar, setCheckGrammar] = useState<boolean>(true);
  const [checkLength, setCheckLength] = useState<boolean>(true);
  const [checkUntranslated, setCheckUntranslated] = useState<boolean>(true);

  // Execution state
  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [issues, setIssues] = useState<SubtitleReviewIssue[]>([]);
  const [modifiedDrafts, setModifiedDrafts] = useState<Map<number, string>>(new Map());

  // Determine active source & draft text
  const activeSourceItem = useMemo(() => {
    return fileQueue.find((f) => f.id === selectedFileId);
  }, [fileQueue, selectedFileId]);

  const activeDraftOutput = useMemo(() => {
    if (!activeSourceItem) return null;
    return translationOutputs.find(
      (out) => out.fileName === activeSourceItem.cachedFileName || out.fileName.includes(activeSourceItem.fileName)
    );
  }, [activeSourceItem, translationOutputs]);

  // Read selected file content
  const [loadedSourceText, setLoadedSourceText] = useState<string>("");

  React.useEffect(() => {
    if (activeSourceItem?.file) {
      const reader = new FileReader();
      reader.onload = (e) => setLoadedSourceText((e.target?.result as string) || "");
      reader.onerror = () => setLoadedSourceText("");
      reader.readAsText(activeSourceItem.file);
    } else {
      setLoadedSourceText("");
    }
  }, [activeSourceItem]);

  const sourceTextToAudit = customSourceText || loadedSourceText;
  const draftTextToAudit = customDraftText || activeDraftOutput?.content || "";
  const subtitleFormat = useMemo(() => {
    const fn = activeSourceItem?.fileName || customFileName || "subtitle.ass";
    const ext = fn.split(".").pop()?.toLowerCase() || "ass";
    return ext === "srt" || ext === "vtt" || ext === "sbv" ? ext : "ass";
  }, [activeSourceItem, customFileName]);

  const activeConfig = getSelectedConfig();
  const auditAbortControllerRef = useRef<AbortController | null>(null);

  const handleCancelAudit = () => {
    if (auditAbortControllerRef.current) {
      auditAbortControllerRef.current.abort();
      auditAbortControllerRef.current = null;
    }
    setIsAuditing(false);
    message.info("Đã hủy kiểm duyệt AI.");
  };

  // Run AI Audit (Supports single file & batch mode with REALTIME streaming & CANCEL)
  const handleStartAudit = async () => {
    const controller = new AbortController();
    auditAbortControllerRef.current = controller;

    // BATCH MODE: Audit all files in queue
    if (selectedFileId === "all_queue") {
      if (fileQueue.length === 0) {
        message.warning("Hàng đợi dịch đang trống.");
        return;
      }

      setIsAuditing(true);
      setProgressPercent(0);
      setIssues([]);

      const totalFiles = fileQueue.length;

      try {
        for (let idx = 0; idx < totalFiles; idx++) {
          if (controller.signal.aborted) break;

          const item = fileQueue[idx];
          const sourceContent = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve((e.target?.result as string) || "");
            reader.onerror = () => resolve("");
            reader.readAsText(item.file);
          });

          const draftOutput = translationOutputs.find(
            (out) => out.fileName === item.cachedFileName || out.fileName.includes(item.fileName)
          );
          const draftContent = draftOutput?.content || "";

          if (sourceContent && draftContent) {
            const ext = item.fileName.split(".").pop()?.toLowerCase() || "ass";
            const fmt = ext === "srt" || ext === "vtt" || ext === "sbv" ? ext : "ass";

            await auditSubtitleCues(
              sourceContent,
              draftContent,
              fmt,
              {
                provider: translationMethod,
                apiKey: activeConfig.apiKey,
                model: activeConfig.model,
                endpoint: activeConfig.url,
                checkTerminology,
                checkGrammar,
                checkLength,
                checkUntranslated,
                contextText: movieSynopsis,
                characterGraphText: characterGraphPromptBlock,
                signal: controller.signal,
                onChunkIssues: (chunkIssues) => {
                  const tagged = chunkIssues.map((iss) => ({
                    ...iss,
                    fileId: item.id,
                    fileName: item.fileName,
                  }));
                  setIssues((prev) => [...prev, ...tagged]);
                },
              }
            );
          }

          setProgressPercent(Math.round(((idx + 1) / totalFiles) * 100));
        }

        if (!controller.signal.aborted) {
          message.success(`Hoàn tất kiểm duyệt ${totalFiles} file!`);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[SubtitleReviewTab] Batch audit failed:", err);
          message.error(`Lỗi kiểm duyệt AI hàng loạt: ${err.message || "Không thể kết nối API AI."}`);
        }
      } finally {
        setIsAuditing(false);
        auditAbortControllerRef.current = null;
      }
      return;
    }

    // BATCH MODE FOR LOCAL FILES (Multiple custom local files)
    if (selectedFileId === "custom_local" && (localSourceMap.size > 1 || localDraftMap.size > 1)) {
      setIsAuditing(true);
      setProgressPercent(0);
      setIssues([]);

      const sources = Array.from(localSourceMap.values());
      const drafts = Array.from(localDraftMap.values());
      const totalLocal = sources.length;

      try {
        for (let idx = 0; idx < totalLocal; idx++) {
          if (controller.signal.aborted) break;

          const srcItem = sources[idx];
          const baseName = srcItem.name.substring(0, srcItem.name.lastIndexOf(".")) || srcItem.name;
          const prefix = baseName.replace(/(\.en|\.ja|\.zh|\.zh-CN|\.vi)$/i, "");
          let draftItem = drafts.find((d) => d.name.includes(prefix) || d.name.includes(baseName));
          if (!draftItem && drafts[idx]) {
            draftItem = drafts[idx];
          }

          if (srcItem.text && draftItem?.text) {
            const ext = srcItem.name.split(".").pop()?.toLowerCase() || "ass";
            const fmt = ext === "srt" || ext === "vtt" || ext === "sbv" ? ext : "ass";

            await auditSubtitleCues(
              srcItem.text,
              draftItem.text,
              fmt,
              {
                provider: translationMethod,
                apiKey: activeConfig.apiKey,
                model: activeConfig.model,
                endpoint: activeConfig.url,
                checkTerminology,
                checkGrammar,
                checkLength,
                checkUntranslated,
                contextText: movieSynopsis,
                characterGraphText: characterGraphPromptBlock,
                signal: controller.signal,
                onChunkIssues: (chunkIssues) => {
                  const tagged = chunkIssues.map((iss) => ({
                    ...iss,
                    fileId: srcItem.name,
                    fileName: srcItem.name,
                  }));
                  setIssues((prev) => [...prev, ...tagged]);
                },
              }
            );
          }

          setProgressPercent(Math.round(((idx + 1) / totalLocal) * 100));
        }

        if (!controller.signal.aborted) {
          message.success(`Hoàn tất kiểm duyệt ${totalLocal} tệp local!`);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[SubtitleReviewTab] Local batch audit failed:", err);
          message.error(`Lỗi kiểm duyệt AI hàng loạt tệp local: ${err.message || "Không thể kết nối API AI."}`);
        }
      } finally {
        setIsAuditing(false);
        auditAbortControllerRef.current = null;
      }
      return;
    }

    // SINGLE FILE MODE
    if (!sourceTextToAudit.trim() || !draftTextToAudit.trim()) {
      message.warning("Vui lòng chọn hoặc tải lên tệp phụ đề gốc và bản dịch để kiểm duyệt.");
      return;
    }

    setIsAuditing(true);
    setProgressPercent(0);
    setIssues([]);

    try {
      await auditSubtitleCues(
        sourceTextToAudit,
        draftTextToAudit,
        subtitleFormat,
        {
          provider: translationMethod,
          apiKey: activeConfig.apiKey,
          model: activeConfig.model,
          endpoint: activeConfig.url,
          checkTerminology,
          checkGrammar,
          checkLength,
          checkUntranslated,
          contextText: movieSynopsis,
          characterGraphText: characterGraphPromptBlock,
          signal: controller.signal,
          onChunkIssues: (chunkIssues) => {
            setIssues((prev) => [...prev, ...chunkIssues]);
          },
        },
        (processed, total) => {
          setProgressPercent(Math.round((processed / total) * 100));
        }
      );

      if (!controller.signal.aborted) {
        message.success("Hoàn tất kiểm duyệt!");
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("[SubtitleReviewTab] Audit failed:", err);
        message.error(`Lỗi kiểm duyệt AI: ${err.message || "Không thể kết nối API AI."}`);
      }
    } finally {
      setIsAuditing(false);
      auditAbortControllerRef.current = null;
    }
  };

  // Toggle single issue application
  const handleToggleApplyIssue = (lineIndex: number, suggestedText: string) => {
    setIssues((prev) =>
      prev.map((item) => (item.lineIndex === lineIndex ? { ...item, applied: !item.applied } : item))
    );

    setModifiedDrafts((prev) => {
      const next = new Map(prev);
      const targetIssue = issues.find((i) => i.lineIndex === lineIndex);
      if (targetIssue && !targetIssue.applied) {
        next.set(lineIndex, suggestedText);
      } else {
        next.delete(lineIndex);
      }
      return next;
    });
  };

  // Accept all suggestions
  const handleAcceptAll = () => {
    const nextMap = new Map<number, string>();
    setIssues((prev) =>
      prev.map((item) => {
        nextMap.set(item.lineIndex, item.suggested);
        return { ...item, applied: true };
      })
    );
    setModifiedDrafts(nextMap);
    message.success(`Đã áp dụng toàn bộ ${issues.length} đề xuất chỉnh sửa của AI!`);
  };

  // Update inline suggested text
  const handleUpdateSuggestedText = (lineIndex: number, newText: string) => {
    setIssues((prev) =>
      prev.map((item) => (item.lineIndex === lineIndex ? { ...item, suggested: newText } : item))
    );
    if (modifiedDrafts.has(lineIndex)) {
      setModifiedDrafts((prev) => new Map(prev).set(lineIndex, newText));
    }
  };

  // Generate final audited subtitle text for single file mode
  const auditedSubtitleText = useMemo(() => {
    if (modifiedDrafts.size === 0) return draftTextToAudit;
    return replaceCueText(draftTextToAudit, subtitleFormat, modifiedDrafts);
  }, [draftTextToAudit, subtitleFormat, modifiedDrafts]);

  // Download audited file (and auto-sync disk cache)
  const handleDownloadAuditedFile = async () => {
    // BATCH MODE DOWNLOAD (.ZIP)
    if (selectedFileId === "all_queue") {
      if (fileQueue.length === 0) return;
      const zip = new JSZip();

      for (const item of fileQueue) {
        const draftOutput = translationOutputs.find(
          (out) => out.fileName === item.cachedFileName || out.fileName.includes(item.fileName)
        );
        const draftText = draftOutput?.content || "";
        if (!draftText) continue;

        const ext = item.fileName.split(".").pop()?.toLowerCase() || "ass";
        const fmt = ext === "srt" || ext === "vtt" || ext === "sbv" ? ext : "ass";

        // Map modified drafts for this item
        const fileModified = new Map<number, string>();
        modifiedDrafts.forEach((suggested, key) => {
          const matchIssue = issues.find((i) => i.lineIndex === key && (i.fileId === item.id || i.fileName === item.fileName));
          if (matchIssue) {
            fileModified.set(key, suggested);
          }
        });

        const finalAuditedText = fileModified.size > 0 ? replaceCueText(draftText, fmt, fileModified) : draftText;

        const nameWithoutExt = item.fileName.substring(0, item.fileName.lastIndexOf(".")) || item.fileName;
        const fileExt = item.fileName.substring(item.fileName.lastIndexOf(".")) || ".ass";
        const downloadName = `${nameWithoutExt}.reviewed${fileExt}`;

        const md5 = item.inputMd5 || "custom";
        await saveFileToDiskCache(item.fileName, targetLanguage || "vi", md5, fmt, finalAuditedText).catch(() => {});

        zip.file(downloadName, finalAuditedText);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadFile(zipBlob, "subtitles_reviewed_all.zip");
      message.success("Đã tải xuống gói ZIP toàn bộ tệp phụ đề đã kiểm duyệt!");
      return;
    }

    // BATCH MODE DOWNLOAD FOR LOCAL FILES (.ZIP)
    if (selectedFileId === "custom_local" && (localSourceMap.size > 1 || localDraftMap.size > 1)) {
      const zip = new JSZip();
      const sources = Array.from(localSourceMap.values());
      const drafts = Array.from(localDraftMap.values());

      for (let idx = 0; idx < sources.length; idx++) {
        const srcItem = sources[idx];
        const baseName = srcItem.name.substring(0, srcItem.name.lastIndexOf(".")) || srcItem.name;
        const prefix = baseName.replace(/(\.en|\.ja|\.zh|\.zh-CN|\.vi)$/i, "");
        let draftItem = drafts.find((d) => d.name.includes(prefix) || d.name.includes(baseName));
        if (!draftItem && drafts[idx]) {
          draftItem = drafts[idx];
        }

        if (!draftItem?.text) continue;

        const ext = srcItem.name.split(".").pop()?.toLowerCase() || "ass";
        const fmt = ext === "srt" || ext === "vtt" || ext === "sbv" ? ext : "ass";

        const fileModified = new Map<number, string>();
        modifiedDrafts.forEach((suggested, key) => {
          const matchIssue = issues.find((i) => i.lineIndex === key && (i.fileName === srcItem.name || i.fileId === srcItem.name));
          if (matchIssue) {
            fileModified.set(key, suggested);
          }
        });

        const finalAuditedText = fileModified.size > 0 ? replaceCueText(draftItem.text, fmt, fileModified) : draftItem.text;

        const nameWithoutExt = srcItem.name.substring(0, srcItem.name.lastIndexOf(".")) || srcItem.name;
        const fileExt = srcItem.name.substring(srcItem.name.lastIndexOf(".")) || ".ass";
        const downloadName = `${nameWithoutExt}.reviewed${fileExt}`;

        zip.file(downloadName, finalAuditedText);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadFile(zipBlob, "subtitles_reviewed_local_all.zip");
      message.success("Đã tải xuống gói ZIP toàn bộ tệp local đã kiểm duyệt!");
      return;
    }

    // SINGLE FILE DOWNLOAD
    if (!auditedSubtitleText.trim()) return;
    const baseName = activeSourceItem?.fileName || customFileName || "subtitle_reviewed.ass";
    const nameWithoutExt = baseName.substring(0, baseName.lastIndexOf(".")) || baseName;
    const ext = baseName.substring(baseName.lastIndexOf(".")) || ".ass";
    const downloadName = `${nameWithoutExt}.reviewed${ext}`;

    const md5 = activeSourceItem?.inputMd5 || "custom";
    await saveFileToDiskCache(baseName, targetLanguage || "vi", md5, subtitleFormat, auditedSubtitleText).catch(() => {});

    downloadFile(auditedSubtitleText, downloadName);
    message.success(`Đã tải xuống tệp phụ đề đã kiểm duyệt: ${downloadName}`);
  };

  // Audit Stats
  const statTotalCues = useMemo(() => parseCues(draftTextToAudit, subtitleFormat).length, [draftTextToAudit, subtitleFormat]);
  const statIssuesCount = issues.length;
  const statTerminologyCount = issues.filter((i) => i.category === "terminology").length;
  const statGrammarCount = issues.filter((i) => i.category === "grammar").length;

  // Table columns definition
  const columns = [
    ...(selectedFileId === "all_queue" || issues.some((i) => i.fileName)
      ? [
          {
            title: "Tệp phụ đề",
            dataIndex: "fileName",
            key: "fileName",
            width: 140,
            render: (fn: string) => (
              <Tag color="cyan" style={{ fontSize: 11, margin: 0, fontWeight: 600 }}>
                📄 {fn}
              </Tag>
            ),
          },
        ]
      : []),
    {
      title: "STT",
      dataIndex: "lineIndex",
      key: "lineIndex",
      width: 70,
      render: (val: number, record: SubtitleReviewIssue) => (
        <Flex vertical gap={2}>
          <Text strong style={{ fontSize: 12 }}>#{val}</Text>
          {record.timecode && <Text type="secondary" style={{ fontSize: 10 }}>{record.timecode}</Text>}
        </Flex>
      ),
    },
    {
      title: "Phân loại & Lý do",
      dataIndex: "category",
      key: "category",
      width: 180,
      render: (cat: string, record: SubtitleReviewIssue) => {
        let tagColor = "blue";
        let catLabel = "Khác";
        if (cat === "terminology") {
          tagColor = "magenta";
          catLabel = "Xưng hô / Đại từ";
        } else if (cat === "grammar") {
          tagColor = "orange";
          catLabel = "Ngữ pháp";
        } else if (cat === "untranslated") {
          tagColor = "red";
          catLabel = "Chưa dịch";
        } else if (cat === "length") {
          tagColor = "purple";
          catLabel = "Độ dài câu";
        }
        return (
          <Flex vertical gap={4} style={{ width: "100%" }}>
            <Tag color={tagColor} style={{ fontWeight: 600, margin: 0 }}>
              {catLabel}
            </Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {record.reason}
            </Text>
          </Flex>
        );
      },
    },
    {
      title: "Bản gốc (Source)",
      dataIndex: "original",
      key: "original",
      width: "24%",
      render: (text: string) => <Text style={{ fontSize: 12 }}>{text}</Text>,
    },
    {
      title: "Bản dịch hiện tại (Draft)",
      dataIndex: "draft",
      key: "draft",
      width: "24%",
      render: (text: string) => (
        <Text style={{ fontSize: 12, color: token.colorTextSecondary, textDecoration: "line-through" }}>
          {text}
        </Text>
      ),
    },
    {
      title: "AI Đề xuất (Suggested Revision)",
      dataIndex: "suggested",
      key: "suggested",
      width: "26%",
      render: (text: string, record: SubtitleReviewIssue) => (
        <Input.TextArea
          value={text}
          autoSize={{ minRows: 1, maxRows: 3 }}
          onChange={(e) => handleUpdateSuggestedText(record.lineIndex, e.target.value)}
          style={{ fontSize: 12, borderColor: record.applied ? token.colorSuccess : undefined }}
        />
      ),
    },
    {
      title: "Thao tác",
      key: "action",
      width: 110,
      render: (_: any, record: SubtitleReviewIssue) => (
        <Button
          size="small"
          type={record.applied ? "primary" : "default"}
          icon={record.applied ? <CheckOutlined /> : <CheckCircleOutlined />}
          onClick={() => handleToggleApplyIssue(record.lineIndex, record.suggested)}>
          {record.applied ? "Đã áp dụng" : "Áp dụng"}
        </Button>
      ),
    },
  ];

  return (
    <Flex vertical gap="middle" style={{ width: "100%" }}>
      {/* Control Card */}
      <Card
        size="small"
        style={{
          background: token.colorBgContainer,
          borderColor: token.colorBorderSecondary,
          borderRadius: token.borderRadiusSM,
        }}>
        <Flex vertical gap="middle">
          {(showLocalUploadPanel || selectedFileId === "custom_local") && (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                    1. Tệp Phụ đề Gốc (Source .srt, .ass, .vtt)
                  </Text>
                  <Upload.Dragger
                    accept=".ass,.srt,.vtt,.sbv,.ssa"
                    multiple
                    showUploadList={false}
                    beforeUpload={handleUploadCustomSource}
                    style={{ padding: "8px", background: token.colorFillAlter }}>
                    <p className="ant-upload-drag-icon" style={{ marginBottom: 2 }}>
                      <UploadOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
                    </p>
                    <Text style={{ fontSize: 12 }}>
                      {localSourceMap.size > 1
                        ? `✔ Đã chọn ${localSourceMap.size} tệp gốc từ máy`
                        : customSourceFileName
                        ? `✔ ${customSourceFileName}`
                        : "Kéo thả hoặc Bấm để chọn Tệp Gốc (Hỗ trợ chọn nhiều tệp)"}
                    </Text>
                  </Upload.Dragger>
                </Col>
                <Col xs={24} md={12}>
                  <Text strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                    2. Tệp Phụ đề Dịch Nháp (Draft .srt, .ass, .vtt)
                  </Text>
                  <Upload.Dragger
                    accept=".ass,.srt,.vtt,.sbv,.ssa"
                    multiple
                    showUploadList={false}
                    beforeUpload={handleUploadCustomDraft}
                    style={{ padding: "8px", background: token.colorFillAlter }}>
                    <p className="ant-upload-drag-icon" style={{ marginBottom: 2 }}>
                      <UploadOutlined style={{ fontSize: 20, color: token.colorSuccess }} />
                    </p>
                    <Text style={{ fontSize: 12 }}>
                      {localDraftMap.size > 1
                        ? `✔ Đã chọn ${localDraftMap.size} tệp dịch từ máy`
                        : customDraftFileName
                        ? `✔ ${customDraftFileName}`
                        : "Kéo thả hoặc Bấm để chọn Tệp Dịch (Hỗ trợ chọn nhiều tệp)"}
                    </Text>
                  </Upload.Dragger>
                </Col>
              </Row>
              <Divider dashed style={{ margin: "10px 0" }} />
            </>
          )}

          <Row gutter={[16, 12]} align="middle">
            <Col xs={24}>
              <Flex vertical gap={6} style={{ width: "100%" }}>
                <Flex align="center" justify="space-between">
                  <Text strong style={{ fontSize: 12 }}>
                    📁 Chọn tệp phụ đề cần kiểm duyệt:
                  </Text>
                  <Button
                    type="link"
                    size="small"
                    icon={<UploadOutlined />}
                    style={{ padding: 0 }}
                    onClick={() => setShowLocalUploadPanel((prev) => !prev)}>
                    {showLocalUploadPanel ? "Thu gọn tải Local" : "Tải tệp từ máy (Local)..."}
                  </Button>
                </Flex>
                <Flex align="center" gap="small" wrap>
                  <Select
                    style={{ flex: 1, minWidth: 280 }}
                    placeholder="-- Chọn tệp từ Hàng đợi dịch --"
                    value={selectedFileId || undefined}
                    onChange={(val) => {
                      setSelectedFileId(val);
                      if (val !== "custom_local") {
                        setCustomSourceText("");
                        setCustomDraftText("");
                        setShowLocalUploadPanel(false);
                      } else {
                        setShowLocalUploadPanel(true);
                      }
                    }}
                    options={[
                      ...(fileQueue.length > 1
                        ? [
                            {
                              label: `⚡ Kiểm duyệt HÀNG LOẠT tất cả (${fileQueue.length} tệp)`,
                              value: "all_queue",
                            },
                          ]
                        : []),
                      ...fileQueue.map((f) => ({
                        label: `${f.fileName} ${f.status === "done" ? "✔ (Đã dịch)" : ""}`,
                        value: f.id,
                      })),
                      {
                        label:
                          localSourceMap.size > 1
                            ? `💻 Local: Kiểm duyệt HÀNG LOẠT ${localSourceMap.size} tệp từ máy`
                            : customSourceFileName && customDraftFileName
                            ? `💻 Local: ${customSourceFileName} ➔ ${customDraftFileName}`
                            : "💻 Tải tệp từ máy tính local...",
                        value: "custom_local",
                      },
                    ]}
                  />
                  {!isAuditing ? (
                    <Button
                      type="primary"
                      icon={<SearchOutlined />}
                      onClick={handleStartAudit}
                      disabled={
                        selectedFileId !== "all_queue" &&
                        selectedFileId !== "custom_local" &&
                        (!sourceTextToAudit || !draftTextToAudit)
                      }>
                      Bắt đầu Kiểm duyệt AI
                    </Button>
                  ) : (
                    <Button
                      danger
                      type="primary"
                      icon={<StopOutlined />}
                      onClick={handleCancelAudit}>
                      Hủy kiểm duyệt
                    </Button>
                  )}
                </Flex>
              </Flex>
            </Col>
          </Row>

          <Divider style={{ margin: "10px 0" }} />

          <Flex align="center" gap="middle" wrap>
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>Tiêu chí quét soát lỗi:</Text>
            <Space size="middle" wrap>
              <Checkbox checked={checkTerminology} onChange={(e) => setCheckTerminology(e.target.checked)}>
                <Text style={{ fontSize: 12 }}>Xưng hô / Đại từ</Text>
              </Checkbox>
              <Checkbox checked={checkGrammar} onChange={(e) => setCheckGrammar(e.target.checked)}>
                <Text style={{ fontSize: 12 }}>Ngữ pháp & Văn phong</Text>
              </Checkbox>
              <Checkbox checked={checkUntranslated} onChange={(e) => setCheckUntranslated(e.target.checked)}>
                <Text style={{ fontSize: 12 }}>Cụm từ chưa dịch</Text>
              </Checkbox>
              <Checkbox checked={checkLength} onChange={(e) => setCheckLength(e.target.checked)}>
                <Text style={{ fontSize: 12 }}>Độ dài câu (&gt;80 ký tự)</Text>
              </Checkbox>
            </Space>
          </Flex>

          {isAuditing && (
            <Flex vertical gap={4} style={{ width: "100%" }}>
              <Flex align="center" justify="space-between">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ⚡ Đang phát hiện lỗi Realtime... ({progressPercent}%)
                </Text>
                <Button
                  danger
                  size="small"
                  type="link"
                  icon={<CloseCircleOutlined />}
                  onClick={handleCancelAudit}>
                  Hủy kiểm duyệt
                </Button>
              </Flex>
              <Progress percent={progressPercent} status="active" />
            </Flex>
          )}
        </Flex>
      </Card>

      {/* Audit Stats Banner */}
      {statTotalCues > 0 && (
        <Row gutter={[12, 12]}>
          <Col flex={1}>
            <Card size="small" style={{ background: token.colorFillAlter, textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Tổng số câu</Text>
              <Title level={4} style={{ margin: "2px 0 0 0" }}>{statTotalCues}</Title>
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small" style={{ background: token.colorFillAlter, textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Phát hiện cần sửa</Text>
              <Title level={4} style={{ margin: "2px 0 0 0", color: statIssuesCount > 0 ? token.colorWarning : token.colorSuccess }}>
                {statIssuesCount}
              </Title>
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small" style={{ background: token.colorFillAlter, textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Lỗi xưng hô</Text>
              <Title level={4} style={{ margin: "2px 0 0 0", color: "#c41d7f" }}>{statTerminologyCount}</Title>
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small" style={{ background: token.colorFillAlter, textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Lỗi ngữ pháp</Text>
              <Title level={4} style={{ margin: "2px 0 0 0", color: "#d46b08" }}>{statGrammarCount}</Title>
            </Card>
          </Col>
          <Col flex={1}>
            <Card size="small" style={{ background: token.colorFillAlter, textAlign: "center" }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Đã áp dụng</Text>
              <Title level={4} style={{ margin: "2px 0 0 0", color: token.colorSuccess }}>{modifiedDrafts.size}</Title>
            </Card>
          </Col>
        </Row>
      )}

      {/* Issues Table */}
      {issues.length > 0 ? (
        <Card
          size="small"
          title={
            <Flex align="center" justify="space-between">
              <Space>
                <FileTextOutlined />
                <Text strong>Danh sách Đề xuất Chỉnh sửa chất lượng ({issues.length} câu)</Text>
              </Space>
              <Space>
                <Button size="small" icon={<CheckOutlined />} type="primary" onClick={handleAcceptAll}>
                  Đồng ý tất cả đề xuất
                </Button>
              </Space>
            </Flex>
          }>
          <Table
            dataSource={issues}
            columns={columns}
            rowKey="lineIndex"
            pagination={{ pageSize: 10, showSizeChanger: true }}
            size="small"
          />
        </Card>
      ) : (
        !isAuditing &&
        draftTextToAudit && (
          <Card size="small" style={{ textAlign: "center", padding: "24px 0" }}>
            <CheckCircleOutlined style={{ fontSize: 36, color: token.colorSuccess, marginBottom: 8 }} />
            <Title level={5} style={{ marginTop: 0 }}>
              Sẵn sàng kiểm duyệt tệp phụ đề
            </Title>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              Nhấn nút <strong>"Bắt đầu Kiểm duyệt AI"</strong> ở trên để phát hiện và soát lỗi xưng hô, ngữ pháp, độ dài câu.
            </Paragraph>
          </Card>
        )
      )}

      {/* Export Action Bar */}
      {draftTextToAudit && (
        <Flex align="center" justify="flex-end" gap="small" style={{ padding: "12px 16px", background: token.colorBgContainer, borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}` }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: "auto" }}>
            {modifiedDrafts.size > 0
              ? `Đã chỉnh sửa ${modifiedDrafts.size} câu.`
              : "Chưa áp dụng chỉnh sửa nào."}
          </Text>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadAuditedFile}>
            Tải xuống file đã duyệt (.srt/.ass)
          </Button>
        </Flex>
      )}
    </Flex>
  );
};

export default SubtitleReviewTab;
