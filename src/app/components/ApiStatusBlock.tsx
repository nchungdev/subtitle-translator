"use client";

import { useState, useRef, useEffect } from "react";
import { Select, Input, Button, Tag, Space, Flex, Typography, Tooltip, App, theme, AutoComplete } from "antd";
import { ApiOutlined, BookOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { categorizedOptions, findMethodLabel, getConfigStatus, getProviderModels, isApiKeyOptional, supportsGlossary, testTranslationWithTimeout, DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from "@/app/lib/translation";
import { describeError } from "@/app/utils";
import { pingSignature } from "@/app/hooks/translation/validation";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { useIsMobile } from "@/app/hooks/useIsMobile";

// Visual states the tag/section can show. The first three come from
// getConfigStatus (registry single-source-of-truth); the last three are
// session-only outcomes from "Test connection".
type StatusState = "free" | "needs-config" | "configured" | "testing" | "connected" | "failed";

interface ApiStatusBlockProps {
  disabled?: boolean;
}

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

const ApiStatusBlock = ({ disabled = false }: ApiStatusBlockProps) => {
  const t = useTranslations("common");
  const tGlossary = useTranslations("TranslationGlossary");
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const isMobile = useIsMobile();
  const { translationMethod, setTranslationMethod, getSelectedConfig, handleConfigChange, systemPrompt, userPrompt, setApiSettingsOpen, glossaryEnabled, activeGlossaryPreset, requestTimeoutSec } = useTranslationContext();

  const config = getSelectedConfig();
  const methodLabel = findMethodLabel(translationMethod);

  const [sessionStatus, setSessionStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [testId, setTestId] = useState(0);

  // Mirror testId into a ref so the async handleTest below can read the
  // latest value after `await` (closure captures snapshot, ref reads live).
  const testIdRef = useRef(testId);
  useEffect(() => {
    testIdRef.current = testId;
  }, [testId]);

  // Invalidate any stale session test result whenever the tested identity
  // changes — handles edits made from this block AND from the API Settings
  // tab (model/url/apiKey both map to translationConfigs[method]).
  // Render-time pattern (React docs § "Adjusting state when a prop changes"):
  // detect against the previous render's snapshot and reset synchronously.
  // React discards the in-progress render and immediately re-renders with
  // the cleared state — no useEffect cascading render needed.
  // 失效判据 = pingSignature(「决定 wire 打到哪」的那组字段,逐字段的理由写在
  // validation.ts 里那个对象字面量的字段注释上)。此前这里手抄了一份同样的
  // 清单,靠注释与它同步 —— 加 relayBase 时就得两处都改,而只有 pingSignature
  // 有回归测试。
  const identity = pingSignature(translationMethod, config);
  const [prevIdentity, setPrevIdentity] = useState(identity);
  if (prevIdentity !== identity) {
    setPrevIdentity(identity);
    setSessionStatus("idle");
    setTestId((t) => t + 1);
  }

  const baseStatus = getConfigStatus(translationMethod, config);

  const status: StatusState = sessionStatus === "testing"
    ? "testing"
    : sessionStatus === "connected"
      ? "connected"
      : sessionStatus === "failed"
        ? "failed"
        : baseStatus;

  const handleTest = async () => {
    const id = testId + 1;
    setTestId(id);
    setSessionStatus("testing");
    const effectiveSystem = systemPrompt?.trim() ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
    const effectiveUser = userPrompt?.trim() ? userPrompt : DEFAULT_USER_PROMPT;
    // 共用入口统一处理超时(= requestTimeoutSec,与正式翻译同源)与
    // thinking 参数派生 —— 原则与实现都在 testTranslationWithTimeout。
    const { error, timedOut } = await testTranslationWithTimeout(translationMethod, config, requestTimeoutSec, effectiveSystem, effectiveUser);
    if (id !== testIdRef.current) return;
    if (!error) {
      setSessionStatus("connected");
      message.success(t("apiStatusConnected"));
    } else {
      // testTranslation returns the caught error object — describeError keeps the
      // raw reason (401/403/CORS/…) and appends the status-mapped i18n hint.
      // 超时触发的 abort:报"超时"分类,而不是裸的 DOMException abort 文案。
      setSessionStatus("failed");
      message.error(`${t("apiStatusFailed")}: ${timedOut ? t("apiStatusTimeout") : describeError(error, t)}`, 10);
    }
  };

  const handleMethodChange = (v: string) => {
    setTranslationMethod(v);
    // render-time identity check above resets sessionStatus on the ensuing render.
  };

  const handleApiKeyChange = (v: string) => {
    handleConfigChange(translationMethod, "apiKey", v);
    // render-time identity check above resets sessionStatus on the ensuing render.
  };

  const tagColor: Record<StatusState, string> = {
    free: "default",
    "needs-config": "warning",
    configured: "default",
    testing: "processing",
    connected: "success",
    failed: "error",
  };

  const tagText: Record<StatusState, string> = {
    free: t("apiStatusFreeApi"),
    "needs-config": t("apiStatusNeedsConfig"),
    configured: t("apiStatusConfigured"),
    testing: t("apiStatusTesting"),
    connected: t("apiStatusConnected"),
    failed: t("apiStatusFailed"),
  };

  // Only color the section when there's an actual signal to convey:
  // green = connected (proved working this session), warning = needs-config,
  // error = failed. "free" and "configured" both stay neutral — the user
  // hasn't verified connectivity yet, and Free APIs routinely get blocked
  // regionally or rate-limited, so a default green would be misleading.
  const sectionBg =
    status === "connected" ? token.colorSuccessBg :
    status === "needs-config" ? token.colorWarningBg :
    status === "failed" ? token.colorErrorBg :
    "transparent";

  const sectionBorder =
    status === "connected" ? token.colorSuccessBorder :
    status === "needs-config" ? token.colorWarningBorder :
    status === "failed" ? token.colorErrorBorder :
    token.colorBorderSecondary;

  // apiKey 输入框只对【真的需要 key】的服务显示,判据与保存校验、服务层同一个。
  const showApiKey = config?.apiKey !== undefined && !isApiKeyOptional(translationMethod);

  return (
    <section
      style={{
        background: sectionBg,
        border: `1px solid ${sectionBorder}`,
        borderRadius: token.borderRadiusLG,
        padding: token.paddingSM,
        marginBottom: token.marginSM,
      }}>
      <Flex justify="space-between" align="center" style={{ marginBottom: token.marginXS }}>
        <Space size="small">
          <ApiOutlined />
          <Typography.Text strong>{t("translationAPI")}</Typography.Text>
          <Tag color={tagColor[status]}>{tagText[status]}</Tag>
        </Space>
      </Flex>

      {/* Mobile: stack Select on top, apiKey input below — 145px-each compact
          row truncates "Custom (OpenAI-compatible)" / "TokenHub (Tencent)"
          beyond recognition. Desktop keeps the dense single-row layout. */}
      {(() => {
        const showModel = config?.model !== undefined;
        const providerModels = (getProviderModels(translationMethod) as Array<{ label: string; value: string }>).map((m) => ({
          label: m.label || m.value,
          value: m.value,
        }));
        return (
          <>
            {isMobile ? (
              <Flex vertical gap={token.marginXS}>
                <Select
                  showSearch
                  value={translationMethod}
                  onChange={handleMethodChange}
                  options={categorizedOptions}
                  style={{ width: "100%" }}
                  disabled={disabled}
                  aria-label={t("translationAPI")}
                />
                {showApiKey && (
                  <Input.Password
                    autoComplete="off"
                    placeholder={`${methodLabel} API Key`}
                    value={config?.apiKey as string | undefined}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    style={{ width: "100%" }}
                    disabled={disabled}
                    aria-label={`${methodLabel} API Key`}
                  />
                )}
              </Flex>
            ) : (
              <Space.Compact className="w-full">
                <Select
                  showSearch
                  value={translationMethod}
                  onChange={handleMethodChange}
                  options={categorizedOptions}
                  style={{ flex: 1, minWidth: 0 }}
                  disabled={disabled}
                  aria-label={t("translationAPI")}
                />
                {showApiKey && (
                  <Tooltip title={`${t("enter")} ${methodLabel} API Key`}>
                    <Input.Password
                      autoComplete="off"
                      placeholder="API Key"
                      value={config?.apiKey as string | undefined}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                      disabled={disabled}
                      aria-label={`${methodLabel} API Key`}
                    />
                  </Tooltip>
                )}
              </Space.Compact>
            )}

            {showModel && (
              <Space.Compact className="w-full" style={{ marginTop: 8 }}>
                <AutoComplete
                  size="small"
                  options={providerModels}
                  placeholder="Mô hình ID (VD: gemini-2.5-flash)"
                  value={(config?.model as string | undefined) || ""}
                  onChange={(val) => handleConfigChange(translationMethod, "model", val ?? "")}
                  style={{ flex: 1 }}
                  disabled={disabled}
                  filterOption={(inputValue, option) =>
                    (option?.value ?? "").toLowerCase().includes(inputValue.toLowerCase()) ||
                    (option?.label ?? "").toLowerCase().includes(inputValue.toLowerCase())
                  }
                  optionRender={(oriOption) => {
                    const value = String(oriOption.value ?? "");
                    const label = String(oriOption.label ?? value);
                    const badge = getModelBadges(value);
                    return (
                      <div style={{ paddingBlock: 2 }}>
                        <Flex align="center" justify="space-between" gap={6}>
                          <Space size={4}>
                            <span style={{ fontWeight: badge?.isRecommended ? 600 : 400 }}>{label}</span>
                            {badge?.isRecommended && (
                              <Tag color="green" style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                                {badge?.badgeText || "Ngon nhất"}
                              </Tag>
                            )}
                          </Space>
                          {badge && (
                            <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
                              {badge.quality}
                            </Tag>
                          )}
                        </Flex>
                        <Flex align="center" justify="space-between" style={{ fontSize: 11, color: token.colorTextDescription, marginTop: 2 }}>
                          <span>{value}</span>
                          {badge && (
                            <span>
                              {badge.note} • Giá: <strong>{badge.cost}</strong>
                            </span>
                          )}
                        </Flex>
                      </div>
                    );
                  }}
                />
              </Space.Compact>
            )}
          </>
        );
      })()}

      <Flex justify="space-between" align="center" wrap gap={4} style={{ marginTop: token.marginXS }}>
        <Space size="small" wrap>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={handleTest}
            loading={sessionStatus === "testing"}
            disabled={disabled || status === "needs-config" || status === "testing"}>
            {t("testConnection")}
          </Button>
          {/* 术语表主页面入口 —— 此前唯一入口埋在设置抽屉深处,终端用户反馈
              "非常隐蔽"。启用时显示词条数(绿),未启用显示灰色入口;点击都
              进设置抽屉(术语表卡片就在 provider 表单下方)。仅在当前服务
              有模型内术语通道时展示(supportsGlossary denylist 之外)。 */}
          {supportsGlossary(translationMethod) && (
          <Tag
            color={glossaryEnabled && activeGlossaryPreset ? "success" : "default"}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={tGlossary("title")}
            style={{ cursor: disabled ? "not-allowed" : "pointer", margin: 0, opacity: disabled ? 0.5 : 1 }}
            onClick={disabled ? undefined : () => setApiSettingsOpen(true)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setApiSettingsOpen(true);
              }
            }}>
            <BookOutlined style={{ marginInlineEnd: 4 }} />
            {glossaryEnabled && activeGlossaryPreset
              ? `${tGlossary("title")} · ${(activeGlossaryPreset.terms ?? []).filter((term) => term.source.trim() && term.target.trim()).length}`
              : tGlossary("title")}
          </Tag>
          )}
        </Space>
        {/* 运行中锁住抽屉入口 —— 抽屉内部因此完全不用锁:mask 保证「抽屉开着时
            开不了跑」(翻译按钮在遮罩后面),入口锁保证「跑着时开不了抽屉」。
            想改设置,先取消(缓存即断点),取消后这里自然解锁。 */}
        <Button
          type="link"
          size="small"
          disabled={disabled}
          onClick={() => setApiSettingsOpen(true)}
          style={{ padding: 0, fontWeight: 500, textDecoration: "underline", textUnderlineOffset: "3px" }}>
          {t("moreProviderSettings")} →
        </Button>
      </Flex>
    </section>
  );
};

export default ApiStatusBlock;
