"use client";

import React, { useState } from "react";
import { Modal, Button, Tabs, Table, Tag, Typography, Space, Spin, Empty, App, Card, Divider, Alert, Flex } from "antd";
import { ShareAltOutlined, ThunderboltOutlined, CopyOutlined, UserOutlined, BranchesOutlined, CheckOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { extractCharacterGraphFromText, buildCharacterGraphPromptBlock } from "@/app/lib/translation/characterGraphService";
import { describeError } from "@/app/utils";
import type { CharacterGraph, FormOfAddress } from "../../../scripts/characterGraph/schema";

const { Text, Paragraph } = Typography;

interface CharacterGraphModalProps {
  open: boolean;
  onClose: () => void;
  sourceText: string;
  fileName?: string;
}

export default function CharacterGraphModal({ open, onClose, sourceText, fileName }: CharacterGraphModalProps) {
  const t = useTranslations("common");
  const { message } = App.useApp();
  const {
    characterGraphEnabled,
    characterGraphProvider = "gemini",
    getCharacterGraphConfig,
    characterGraphPromptBlock,
    setCharacterGraphPromptBlock,
  } = useTranslationContext();

  const [graphData, setGraphData] = useState<CharacterGraph | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const activeGraphConfig = getCharacterGraphConfig ? getCharacterGraphConfig(characterGraphProvider) : { apiKey: "", model: "" };

  const handleAnalyzeGraph = async () => {
    if (!sourceText || sourceText.trim().length === 0) {
      message.warning(t("noFileUploaded", { defaultValue: "Vui lòng tải tệp phụ đề hoặc dán văn bản trước khi phân tích." }));
      return;
    }
    setLoading(true);
    try {
      const result = await extractCharacterGraphFromText(sourceText, {
        sourceFileName: fileName || "subtitle.ass",
        provider: characterGraphProvider,
        apiKey: activeGraphConfig.apiKey,
        model: activeGraphConfig.model,
        endpoint: activeGraphConfig.url,
      });

      if (result) {
        setGraphData(result);
        const block = buildCharacterGraphPromptBlock(result);
        if (setCharacterGraphPromptBlock) {
          setCharacterGraphPromptBlock(block);
        }
        message.success("Đã phân tích thành công Đồ thị quan hệ nhân vật!");
      } else {
        message.error("Không thể trích xuất đồ thị quan hệ. Vui lòng kiểm tra API Key hoặc Model ID.");
      }
    } catch (err) {
      console.warn("[CharacterGraph] Analysis error:", err);
      message.error(describeError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPromptBlock = () => {
    if (!characterGraphPromptBlock) return;
    navigator.clipboard.writeText(characterGraphPromptBlock);
    setCopied(true);
    message.success("Đã sao chép Khối quy tắc xưng hô vào bộ nhớ tạm!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper for character name map lookup
  const getCharName = (id: string) => {
    if (!graphData?.characters) return id;
    const found = graphData.characters.find((c) => c.id === id);
    return found ? `${found.canonicalName} (${found.id})` : id;
  };

  const tableColumns = [
    {
      title: "Nhân vật gọi",
      dataIndex: "usedBy",
      key: "usedBy",
      render: (val: string) => (
        <Space size="small">
          <UserOutlined />
          <Text strong>{getCharName(val)}</Text>
        </Space>
      ),
    },
    {
      title: "Gọi nhân vật",
      dataIndex: "usedFor",
      key: "usedFor",
      render: (val: string) => (
        <Space size="small">
          <UserOutlined />
          <Text>{getCharName(val)}</Text>
        </Space>
      ),
    },
    {
      title: "Từ xưng hô (gốc / tự xưng)",
      key: "terms",
      render: (_: unknown, record: FormOfAddress) => (
        <Space orientation="vertical" size={2}>
          <Tag color="blue">Gọi: {record.term}</Tag>
          {record.selfReference && <Tag color="cyan">Tự xưng: {record.selfReference}</Tag>}
        </Space>
      ),
    },
    {
      title: "Sắc thái quan hệ",
      dataIndex: "register",
      key: "register",
      render: (val: string) => <Tag color="purple">{val || "Thường"}</Tag>,
    },
    {
      title: "Thời điểm xuất hiện",
      dataIndex: "firstSeenAt",
      key: "firstSeenAt",
      render: (val: string) => <Text type="secondary" style={{ fontSize: 12 }}>{val || "00:00:00"}</Text>,
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
        characterGraphPromptBlock && (
          <Button key="copy" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={handleCopyPromptBlock}>
            {copied ? "Đã sao chép" : "Sao chép quy tắc"}
          </Button>
        ),
        <Button key="analyze" type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={handleAnalyzeGraph}>
          {graphData || characterGraphPromptBlock ? "Phân tích lại" : "⚡ Phân tích đồ thị"}
        </Button>,
      ]}
      width={800}
      title={
        <Space>
          <ShareAltOutlined style={{ color: "#1D35F5" }} />
          <span>Xem Đồ Thị Quan Hệ & Xưng Hô (Character Graph)</span>
        </Space>
      }>
      <Space vertical className="w-full" size="middle">
        <Alert
          type="info"
          showIcon
          title={
            <Flex justify="space-between" align="center" className="w-full">
              <span>
                🤖 Mô hình trích xuất: <Text strong>{characterGraphProvider.toUpperCase()}</Text> ({activeGraphConfig.model || "Mặc định"})
              </span>
              <Tag color={characterGraphEnabled ? "success" : "default"}>
                {characterGraphEnabled ? "Đã bật tự động trong Dịch" : "Chưa bật trong Dịch"}
              </Tag>
            </Flex>
          }
          description="Hệ thống sử dụng LLM để trích xuất sơ đồ đại từ xưng hô (anh/em, sếp/cậu, tớ/cậu...) trước khi dịch nhằm đảm bảo nhất quán 100% xuyên suốt phim."
        />

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <Spin size="large" tip="Đang dùng AI phân tích danh sách nhân vật & mối quan hệ xưng hô trong phụ đề..." />
          </div>
        ) : graphData || characterGraphPromptBlock ? (
          <Tabs
            defaultActiveKey="table"
            items={[
              {
                key: "table",
                label: (
                  <span>
                    <BranchesOutlined /> Bảng Cặp Xưng Hô ({graphData?.formsOfAddress?.length || 0})
                  </span>
                ),
                children: (
                  <div>
                    {graphData?.characters && graphData.characters.length > 0 && (
                      <Card size="small" title="🎭 Danh sách nhân vật nhận diện được" style={{ marginBottom: 12 }}>
                        <Space wrap>
                          {graphData.characters.map((c) => (
                            <Tag key={c.id} color="blue" style={{ padding: "4px 8px" }}>
                              <Text strong>{c.canonicalName}</Text> {c.role && `(${c.role})`}
                            </Tag>
                          ))}
                        </Space>
                      </Card>
                    )}

                    {graphData?.formsOfAddress && graphData.formsOfAddress.length > 0 ? (
                      <Table
                        dataSource={graphData.formsOfAddress.map((item, idx) => ({ ...item, key: idx }))}
                        columns={tableColumns}
                        pagination={{ pageSize: 5 }}
                        size="small"
                      />
                    ) : (
                      <Paragraph type="secondary">
                        Đã tạo khối quy tắc xưng hô dạng văn bản prompt bên tab Khối Quy Tắc Prompt.
                      </Paragraph>
                    )}
                  </div>
                ),
              },
              {
                key: "promptBlock",
                label: (
                  <span>
                    <CopyOutlined /> Khối Quy Tắc Prompt (LLM Rules)
                  </span>
                ),
                children: (
                  <div>
                    <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Khối quy tắc xưng hô này sẽ tự động ghép vào System Prompt khi gửi dữ liệu sang mô hình dịch:
                      </Text>
                      <Button size="small" icon={<CopyOutlined />} onClick={handleCopyPromptBlock}>
                        Sao chép
                      </Button>
                    </Flex>
                    <pre
                      style={{
                        background: "#191815",
                        color: "#4CC38A",
                        padding: 12,
                        borderRadius: 4,
                        maxHeight: 300,
                        overflowY: "auto",
                        fontSize: 12,
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                      }}>
                      {characterGraphPromptBlock || "Chưa có quy tắc nào."}
                    </pre>
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <Empty
            description="Chưa có dữ liệu Đồ thị quan hệ cho tệp phụ đề hiện tại."
            image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleAnalyzeGraph}>
              ⚡ Phân tích Đồ thị quan hệ ngay
            </Button>
          </Empty>
        )}
      </Space>
    </Modal>
  );
}
