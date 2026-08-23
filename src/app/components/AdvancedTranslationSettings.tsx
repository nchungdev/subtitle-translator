"use client";

import React, { useState } from "react";
import { AutoComplete, ConfigProvider, Flex, Input, InputNumber, Row, Col, Tooltip, Switch, Form, Typography, theme, Select, Tag, Space, Button, App } from "antd";
import { ApiOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import Section from "@/app/components/styled/Section";
import { getProviderModels } from "@/app/lib/translation";
import { extractCharacterGraphFromText } from "@/app/lib/translation/characterGraphService";
import { describeError } from "@/app/utils";

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

  const activeGraphConfig = getCharacterGraphConfig ? getCharacterGraphConfig(characterGraphProvider) : { apiKey: "", model: "" };
  const providerModels = (getProviderModels(characterGraphProvider) as Array<{ label: string; value: string }>).map((m) => ({
    label: m.label !== m.value ? `${m.label} (${m.value})` : m.value,
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
          <Flex component="label" className="cursor-pointer" justify="space-between" align="center">
            <Tooltip title={tooltipCharacterGraph}>
              <Text>{labelCharacterGraph}</Text>
            </Tooltip>
            <Switch size="small" checked={characterGraphEnabled} onChange={setCharacterGraphEnabled} aria-label={labelCharacterGraph} />
          </Flex>
          {characterGraphEnabled && (
            <section
              style={{
                background:
                  sessionStatus === "connected"
                    ? token.colorSuccessBg
                    : sessionStatus === "failed"
                    ? token.colorErrorBg
                    : token.colorFillAlter,
                border: `1px solid ${
                  sessionStatus === "connected"
                    ? token.colorSuccessBorder
                    : sessionStatus === "failed"
                    ? token.colorErrorBorder
                    : token.colorBorderSecondary
                }`,
                borderRadius: token.borderRadiusLG,
                padding: token.paddingSM,
                marginTop: token.marginXS,
                marginBottom: token.marginXS,
              }}>
              <Flex justify="space-between" align="center" style={{ marginBottom: token.marginXS }}>
                <Space size="small">
                  <ApiOutlined />
                  <Typography.Text strong>API Đồ thị xưng hô</Typography.Text>
                  <Tag
                    color={
                      sessionStatus === "connected"
                        ? "success"
                        : sessionStatus === "failed"
                        ? "error"
                        : activeGraphConfig.apiKey
                        ? "cyan"
                        : "warning"
                    }>
                    {sessionStatus === "connected"
                      ? "Đã kết nối"
                      : sessionStatus === "failed"
                      ? "Lỗi kết nối"
                      : activeGraphConfig.apiKey
                      ? "Đã cấu hình"
                      : "Cần cấu hình"}
                  </Tag>
                </Space>
              </Flex>

              <Space.Compact className="w-full">
                {setCharacterGraphProvider && (
                  <Select
                    showSearch
                    value={characterGraphProvider}
                    onChange={setCharacterGraphProvider}
                    style={{ flex: 1, minWidth: 120 }}
                    options={[
                      { label: "Google Gemini", value: "gemini" },
                      { label: "OpenAI", value: "openai" },
                      { label: "Anthropic Claude", value: "claude" },
                      { label: "DeepSeek AI", value: "deepseek" },
                      { label: "OpenCode Zen", value: "opencode" },
                      { label: "LM Studio / Ollama", value: "lmstudio" },
                    ]}
                  />
                )}
                <Tooltip title="API Key cho mô hình Đồ thị xưng hô">
                  <Input.Password
                    autoComplete="off"
                    placeholder="API Key"
                    value={activeGraphConfig.apiKey || ""}
                    onChange={(e) => updateCharacterGraphConfig && updateCharacterGraphConfig(characterGraphProvider, { apiKey: e.target.value })}
                    style={{ flex: 1, minWidth: 120 }}
                  />
                </Tooltip>
              </Space.Compact>

              <Space.Compact className="w-full" style={{ marginTop: 8 }}>
                <AutoComplete
                  size="small"
                  options={providerModels}
                  placeholder="Mô hình ID (VD: gemini-2.5-flash)"
                  value={activeGraphConfig.model || ""}
                  onChange={(val) => updateCharacterGraphConfig && updateCharacterGraphConfig(characterGraphProvider, { model: val })}
                  style={{ flex: 1 }}
                  filterOption={(inputValue, option) =>
                    (option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase()) ||
                    (option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
                  }
                />
              </Space.Compact>

              <Flex justify="space-between" align="center" wrap gap={4} style={{ marginTop: token.marginXS }}>
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  onClick={handleTestConnection}
                  loading={sessionStatus === "testing"}
                  disabled={disabled}>
                  {t("testConnection", { defaultValue: "Kiểm tra kết nối" })}
                </Button>
                {setApiSettingsOpen && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={() => setApiSettingsOpen(true)}>
                    {t("moreProviderSettings", { defaultValue: "Thêm cài đặt Provider →" })}
                  </Button>
                )}
              </Flex>
            </section>
          )}
          <Flex justify="space-between" align="center">
            <Tooltip title={t("useCacheTooltip")}>
              <Text>{t("useCache")}</Text>
            </Tooltip>
            <Switch size="small" checked={useCache} onChange={setUseCache} aria-label={t("useCache")} />
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
