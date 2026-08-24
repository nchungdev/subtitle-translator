"use client";

import React, { useState, useEffect } from "react";
import { AutoComplete, ConfigProvider, Flex, Input, InputNumber, Row, Col, Tooltip, Switch, Form, Typography, theme, Select, Tag, Space, Button, App, Popconfirm } from "antd";
import { ApiOutlined, ThunderboltOutlined, DeleteOutlined, ClearOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import Section from "@/app/components/styled/Section";
import { getProviderModels, GENRE_STYLE_OPTIONS } from "@/app/lib/translation";
import { extractCharacterGraphFromText } from "@/app/lib/translation/characterGraphService";
import { describeError } from "@/app/utils";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { clearAllDiskCache, getDiskCacheCount } from "@/app/lib/storage/fileDiskCache";
import { translationCache } from "@/app/lib/storage/indexedDBStorage";

const { Text } = Typography;

interface AdvancedTranslationSettingsProps {
  // Export filename
  customFileName: string;
  setCustomFileName: (value: string) => void;
  // Remove chars
  removeChars: string;
  setRemoveChars: (value: string) => void;
  // Retry settings
  retryCount: number;
  setRetryCount: (value: number) => void;
  requestTimeoutSec: number;
  setRequestTimeoutSec: (value: number) => void;
  // Use cache
  useCache: boolean;
  setUseCache: (value: boolean) => void;
  // Single File Mode
  singleFileMode?: boolean;
  setSingleFileMode?: (value: boolean) => void;
  // Character Graph (Independent per-provider configs)
  characterGraphEnabled?: boolean;
  setCharacterGraphEnabled?: (value: boolean) => void;
  characterGraphProvider?: string;
  setCharacterGraphProvider?: (value: string) => void;
  getCharacterGraphConfig?: (provider?: string) => { apiKey?: string; model?: string; url?: string };
  updateCharacterGraphConfig?: (provider: string, config: { apiKey?: string; model?: string; url?: string }) => void;
  setApiSettingsOpen?: (open: boolean) => void;
  translationMethod?: string;
  activeModel?: string;
  // Optional: custom children for component-specific settings (rendered before the common settings)
  children?: React.ReactNode;
  disabled?: boolean;
}

const AdvancedTranslationSettings: React.FC<AdvancedTranslationSettingsProps> = ({
  customFileName,
  setCustomFileName,
  removeChars,
  setRemoveChars,
  retryCount,
  setRetryCount,
  requestTimeoutSec,
  setRequestTimeoutSec,
  useCache,
  setUseCache,
  characterGraphEnabled,
  setCharacterGraphEnabled,
  characterGraphProvider = "gemini",
  setCharacterGraphProvider,
  getCharacterGraphConfig,
  updateCharacterGraphConfig,
  setApiSettingsOpen,
  translationMethod,
  activeModel,
  children,
  disabled = false,
  singleFileMode,
  setSingleFileMode,
}) => {
  const t = useTranslations("common");
  const { token } = theme.useToken();

  const getModelBadges = (value: string) => {
    const v = value.toLowerCase();
    if (v.includes("3.7-flash")) {
      return { cost: "Cực rẻ / Free", quality: "★★★★★", isRecommended: true, badgeText: "Ngon nhất", note: "👑 Thế hệ mới nhất" };
    }
    if (v.includes("2.5-flash")) {
      return { cost: "Cực rẻ / Free", quality: "★★★★☆", isRecommended: false, note: "⚡ Rất mượt • Phổ biến" };
    }
    if (v.includes("3.5-flash-lite")) {
      return { cost: "Siêu rẻ / Free", quality: "★★★☆☆", isRecommended: false, note: "🚀 Tốc độ cao" };
    }
    if (v.includes("3.5-flash") || v.includes("1.5-flash")) {
      return { cost: "Rẻ / Free", quality: "★★★★☆", isRecommended: false, note: "⚡ Cân bằng" };
    }
    if (v.includes("3.1-pro") || v.includes("pro-preview") || v.includes("gemini-1.5-pro")) {
      return { cost: "Trung bình", quality: "★★★★★", isRecommended: false, note: "🧠 Suy luận cao cấp" };
    }
    if (v.includes("deepseek-v4-flash") || v.includes("deepseek-chat")) {
      return { cost: "Cực rẻ", quality: "★★★★★", isRecommended: true, badgeText: "Ngon nhất", note: "👑 Văn phong mượt" };
    }
    if (v.includes("deepseek-v4-pro") || v.includes("deepseek-reasoner")) {
      return { cost: "Rẻ", quality: "★★★★★", isRecommended: false, note: "🧠 Suy luận sâu" };
    }
    if (v.includes("gpt-4o-mini") || v.includes("5.4-mini") || v.includes("5.6-luna")) {
      return { cost: "Rẻ", quality: "★★★★☆", isRecommended: false, note: "⚡ Ổn định" };
    }
    if (v.includes("gpt-4o") || v.includes("gpt-5.6")) {
      return { cost: "Giá cao", quality: "★★★★★", isRecommended: false, note: "💎 Cao cấp" };
    }
    if (v.includes("claude-sonnet")) {
      return { cost: "Giá cao", quality: "★★★★★", isRecommended: true, badgeText: "Đỉnh nhất", note: "👑 Chất lượng cao nhất" };
    }
    if (v.includes("claude-haiku")) {
      return { cost: "Rẻ", quality: "★★★★☆", isRecommended: false, note: "⚡ Tốc độ" };
    }
    if (v.includes("claude-opus")) {
      return { cost: "Giá rất cao", quality: "★★★★★", isRecommended: false, note: "💎 Siêu cao cấp" };
    }
    return null;
  };

  const activeGraphConfig = getCharacterGraphConfig ? getCharacterGraphConfig(characterGraphProvider) : { apiKey: "", model: "" };
  const providerModels = (getProviderModels(characterGraphProvider) as Array<{ label: string; value: string }>).map((m) => ({
    label: m.label || m.value,
    value: m.value,
  }));

  const [sessionStatus, setSessionStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const { message } = App.useApp();

  const handleTestConnection = async () => {
    setSessionStatus("testing");
    try {
      const graph = await extractCharacterGraphFromText(
        "1\n00:00:01,000 --> 00:00:03,000\nHello, how are you?",
        {
          sourceFileName: "test.ass",
          provider: characterGraphProvider,
          apiKey: activeGraphConfig.apiKey,
          model: activeGraphConfig.model,
          endpoint: activeGraphConfig.url,
        }
      );
      setSessionStatus("connected");
      message.success(t("apiStatusConnected", { defaultValue: "Kết nối API Đồ thị xưng hô thành công!" }));
    } catch (err) {
      setSessionStatus("failed");
      console.warn("[CharacterGraph] Test connection failed:", err);
      message.error(describeError(err, t));
    }
  };

  const labelCharacterGraph = t.has("characterGraphEnabled")
    ? t("characterGraphEnabled")
    : "Tự động phân tích & giữ nhất quán xưng hô (Character Graph)";

  const tooltipCharacterGraph = t.has("characterGraphEnabledTooltip")
    ? t("characterGraphEnabledTooltip")
    : "Sử dụng AI phân tích toàn bộ file trước khi dịch để trích xuất cặp xưng hô (anh/em, chị/em, tớ/cậu...), đảm bảo đại từ xưng hô nhất quán 100% xuyên suốt phim.";

  const { genreStyle = "default", setGenreStyle, movieSynopsis = "", setMovieSynopsis } = useTranslationContext();

  return (
    <ConfigProvider componentDisabled={disabled}>
    <Flex vertical gap="middle">
      {/* 1. General Switches */}
      <Section variant="neutral" noGap>
        <Flex vertical gap="small">
          {children}
          {setSingleFileMode && (
            <Flex component="label" className="cursor-pointer" justify="space-between" align="center">
              <Tooltip title={t("singleFileModeTooltip")}>
                <Text>{t("singleFileMode")}</Text>
              </Tooltip>
              <Switch size="small" checked={singleFileMode} onChange={setSingleFileMode} aria-label={t("singleFileMode")} />
            </Flex>
          )}
          <Flex justify="space-between" align="center">
            <Tooltip title={t("useCacheTooltip")}>
              <Text>{t("useCache")}</Text>
            </Tooltip>
            <Switch size="small" checked={useCache} onChange={setUseCache} aria-label={t("useCache")} />
          </Flex>

          <Flex justify="space-between" align="center" style={{ marginTop: 4, paddingTop: 6, borderTop: `1px dashed ${token.colorBorderSecondary}` }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              💾 Đang lưu bộ nhớ đệm Cache tệp đã dịch
            </Text>
            <Popconfirm
              title="Xóa Cache tệp phụ đề?"
              description="Bạn có chắc chắn muốn xóa tất cả file phụ đề đã dịch & câu dịch trong bộ nhớ đệm? (Giữ nguyên bối cảnh & nhân vật)"
              okText="Xóa Cache Phụ đề"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={async () => {
                try {
                  const diskCleared = await clearAllDiskCache();
                  const lineCleared = await translationCache.clear();
                  message.success(`Đã xóa sạch cache phụ đề! (${diskCleared} tệp & ${lineCleared} câu dịch - Giữ nguyên bối cảnh & nhân vật)`);
                } catch {
                  message.error("Không thể xóa cache.");
                }
              }}>
              <Button
                size="small"
                danger
                type="link"
                icon={<ClearOutlined />}
                style={{ padding: 0, fontSize: 12 }}>
                Xóa sạch Cache
              </Button>
            </Popconfirm>
          </Flex>
        </Flex>
      </Section>

      {/* 2. Network / Resilience */}
      <Section variant="neutral" noGap>
        <Form layout="vertical" component="div">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={t("retryCount")} tooltip={t("retryCountTooltip")} className="!mb-0">
                <InputNumber min={1} max={10} value={retryCount} onChange={(value) => setRetryCount(value ?? 3)} className="!w-full" aria-label={t("retryCount")} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("requestTimeoutSec")} tooltip={t("requestTimeoutSecTooltip")} className="!mb-0">
                <InputNumber min={5} max={1200} value={requestTimeoutSec} onChange={(value) => setRequestTimeoutSec(value ?? 30)} suffix="s" className="!w-full" aria-label={t("requestTimeoutSec")} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Section>

      {/* 3. Output Formatting */}
      <Section variant="neutral" noGap>
        <Form layout="vertical">
          <Form.Item label={t("removeCharsAfterTranslation")} tooltip={t("removeCharsAfterTranslationTooltip")} className="!mb-3">
            <Input placeholder={`${t("example")}: ♪ <i> </i>`} value={removeChars} onChange={(e) => setRemoveChars(e.target.value)} allowClear aria-label={t("removeCharsAfterTranslation")} spellCheck={false} />
          </Form.Item>
          <Form.Item label={t("customExportFilename")} tooltip={t("customExportFilenameTooltip")} className="!mb-0">
            <Input value={customFileName} placeholder="{name}.{ext}" onChange={(e) => setCustomFileName(e.target.value)} allowClear aria-label={t("customExportFilename")} spellCheck={false} />
          </Form.Item>
        </Form>
      </Section>
    </Flex>
    </ConfigProvider>
  );
};

export default AdvancedTranslationSettings;
