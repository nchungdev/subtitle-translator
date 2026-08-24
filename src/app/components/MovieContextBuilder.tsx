"use client";

import React, { useState, useEffect } from "react";
import { Card, Input, Button, Flex, Typography, Tooltip, Upload, Tag, Space, App, Collapse, theme, Row, Col, Tabs, Select } from "antd";
import {
  LinkOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  UploadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  UsergroupAddOutlined,
  BookOutlined,
  GlobalOutlined,
  VideoCameraOutlined,
  StarOutlined,
  ReloadOutlined,
  EyeOutlined,
  CodeOutlined,
  HistoryOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useTranslationContext } from "@/app/components/TranslationContext";
import { generateMovieContextFromInput, extractDetailedCharacterGraphFromSampleSubtitles } from "@/app/lib/translation/movieContextService";
import { describeError } from "@/app/utils";
import { extractMovieId, getCachedContextById, setCachedContextById, getMostRecentContextCache, getRecentContextHistoryList } from "@/app/lib/storage/contextCache";
import { useLocalStorage } from "@/app/hooks/useLocalStorage";

const { Text, Paragraph } = Typography;

export const MovieContextBuilder: React.FC<{ onProcessingChange?: (isProcessing: boolean) => void; disabled?: boolean }> = ({ onProcessingChange, disabled }) => {
  const t = useTranslations("common");
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const {
    movieSynopsis,
    setMovieSynopsis,
    characterGraphPromptBlock,
    setCharacterGraphPromptBlock,
    translationMethod,
    getSelectedConfig,
  } = useTranslationContext();

  const [wikiUrl, setWikiUrl] = useLocalStorage<string>("subtitle-translator-wikiUrl", "");
  const [imdbUrl, setImdbUrl] = useLocalStorage<string>("subtitle-translator-imdbUrl", "");
  const [tmdbOrText, setTmdbOrText] = useLocalStorage<string>("subtitle-translator-tmdbOrText", "");
  
  const [generatingContext, setGeneratingContext] = useState(false);
  const [sampleFiles, setSampleFiles] = useState<{ name: string; content: string }[]>([]);
  const [extractingGraph, setExtractingGraph] = useState(false);

  useEffect(() => {
    onProcessingChange?.(generatingContext || extractingGraph);
  }, [generatingContext, extractingGraph, onProcessingChange]);

  const [detectedId, setDetectedId] = useState<string | null>(null);
  const [hasCachedData, setHasCachedData] = useState<boolean>(false);
  
  // Tab states for content display
  const [part1Tab, setPart1Tab] = useState<string>("formatted");
  const [part2Tab, setPart2Tab] = useState<string>("formatted");

  // Sample files collapse toggle state
  const [collapseSamples, setCollapseSamples] = useState<boolean>(true);

  const activeConfig = getSelectedConfig();
  const lastLoadedIdRef = React.useRef<string | null>(null);
  const historyList = getRecentContextHistoryList();

  // Helper to load a cached context entry and fill ALL fields (URLs + Synopsis + Graph)
  const loadCachedEntryIntoState = (cached: ReturnType<typeof getCachedContextById>) => {
    if (!cached) return;
    lastLoadedIdRef.current = cached.movieId;

    // 1. Restore Synopsis & Character Graph
    if (setMovieSynopsis) setMovieSynopsis(cached.synopsis || "");
    if (setCharacterGraphPromptBlock) setCharacterGraphPromptBlock(cached.characterGraphText || "");

    // 2. Restore or derive URLs
    let wUrl = cached.wikiUrl || "";
    let iUrl = cached.imdbUrl || "";
    let tUrl = cached.tmdbOrText || "";

    // Fallback URL generation if old cache entry didn't store explicit URLs
    if (!iUrl && cached.movieId?.startsWith("tt")) {
      iUrl = `https://www.imdb.com/title/${cached.movieId}/`;
    }
    if (!tUrl && (cached.movieId?.startsWith("movie/") || cached.movieId?.startsWith("tv/"))) {
      tUrl = `https://www.themoviedb.org/${cached.movieId}`;
    }

    setWikiUrl(wUrl);
    setImdbUrl(iUrl);
    setTmdbOrText(tUrl);
  };

  // On initial mount: auto-restore the most recently viewed context (ALL fields filled)
  useEffect(() => {
    const mostRecent = getMostRecentContextCache();
    if (mostRecent) {
      loadCachedEntryIntoState(mostRecent);
    }
  }, []);

  // Auto detect IMDb/TMDB ID from URL inputs and AUTO-LOAD cache if changed
  useEffect(() => {
    const combined = `${wikiUrl} ${imdbUrl} ${tmdbOrText}`;
    const id = extractMovieId(combined);
    setDetectedId(id);

    if (id) {
      const cached = getCachedContextById(id);
      if (cached) {
        setHasCachedData(true);
        if (lastLoadedIdRef.current !== id) {
          loadCachedEntryIntoState(cached);
        }
      } else {
        setHasCachedData(false);
      }
    } else {
      setHasCachedData(false);
    }
  }, [wikiUrl, imdbUrl, tmdbOrText]);

  // Select item from 50-item cache history
  const handleSelectHistoryItem = (movieId: string) => {
    const item = getCachedContextById(movieId);
    if (item) {
      loadCachedEntryIntoState(item);
      message.success(`Đã chuyển sang Bối cảnh Cache cho ID: ${item.movieId}`);
    }
  };

  // Load from cache handler (Manual reload)
  const handleLoadFromCache = () => {
    if (!detectedId) return;
    const cached = getCachedContextById(detectedId);
    if (cached) {
      loadCachedEntryIntoState(cached);
      message.success(`Đã tự động nạp Bối cảnh, Quan hệ & các Link từ Cache (ID: ${detectedId})`);
    }
  };

  // Helper to handle multi-source AI generation
  const handleGenerateContext = async () => {
    const sources: string[] = [];
    if (wikiUrl.trim()) sources.push(`- Link Wikipedia: ${wikiUrl.trim()}`);
    if (imdbUrl.trim()) sources.push(`- Link IMDb: ${imdbUrl.trim()}`);
    if (tmdbOrText.trim()) sources.push(`- Link TMDB / Mô tả bối cảnh: ${tmdbOrText.trim()}`);

    if (sources.length === 0) {
      message.warning("Vui lòng nhập ít nhất 1 nguồn (Wikipedia, IMDb, TMDB hoặc Mô tả phim).");
      return;
    }

    const combinedInput = sources.join("\n");

    setGeneratingContext(true);
    try {
      const result = await generateMovieContextFromInput(combinedInput, {
        provider: translationMethod,
        apiKey: activeConfig.apiKey,
        model: activeConfig.model,
        endpoint: activeConfig.url,
      });

      if (setMovieSynopsis) {
        setMovieSynopsis(result);
      }
      if (detectedId) {
        setCachedContextById(detectedId, {
          synopsis: result,
          characterGraphText: characterGraphPromptBlock || "",
          wikiUrl,
          imdbUrl,
          tmdbOrText,
        });
        setHasCachedData(true);
      }
      message.success("Tạo bối cảnh phim & nhân vật tổng hợp thành công!");
    } catch (err) {
      console.error("[MovieContextBuilder] Context generation failed:", err);
      message.error(describeError(err, t));
    } finally {
      setGeneratingContext(false);
    }
  };

  // Helper to read uploaded sample subtitle files
  const handleSampleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setSampleFiles((prev) => [...prev, { name: file.name, content }]);
      }
    };
    reader.readAsText(file);
    return false; // Prevent upload
  };

  const handleRemoveSampleFile = (index: number) => {
    setSampleFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Helper to extract detailed character graph from sample files
  const handleExtractCharacterGraph = async () => {
    if (sampleFiles.length === 0) {
      message.warning("Vui lòng tải lên ít nhất 1 file phụ đề mẫu (Tập 1, 2...) để trích xuất.");
      return;
    }

    setExtractingGraph(true);
    try {
      const result = await extractDetailedCharacterGraphFromSampleSubtitles(
        sampleFiles.map((f) => f.content),
        movieSynopsis || "",
        {
          provider: translationMethod,
          apiKey: activeConfig.apiKey,
          model: activeConfig.model,
          endpoint: activeConfig.url,
        }
      );

      if (setCharacterGraphPromptBlock) {
        setCharacterGraphPromptBlock(result);
      }
      if (detectedId) {
        setCachedContextById(detectedId, {
          synopsis: movieSynopsis || "",
          characterGraphText: result,
          wikiUrl,
          imdbUrl,
          tmdbOrText,
        });
        setHasCachedData(true);
      }
      message.success("Trích xuất quan hệ nhân vật chi tiết thành công!");
    } catch (err) {
      console.error("[MovieContextBuilder] Graph extraction failed:", err);
      message.error(describeError(err, t));
    } finally {
      setExtractingGraph(false);
    }
  };

  // Recursive value renderer for JSON objects in synopsis
  const renderValueFormatted = (val: any): React.ReactNode => {
    if (Array.isArray(val)) {
      return (
        <Flex vertical gap={4}>
          {val.map((item, itemIdx) => (
            <div key={itemIdx} style={{ background: token.colorBgContainer, padding: "4px 8px", borderRadius: 4, border: `1px solid ${token.colorBorderSecondary}` }}>
              {typeof item === "object" ? renderValueFormatted(item) : <Text style={{ fontSize: 12 }}>{String(item)}</Text>}
            </div>
          ))}
        </Flex>
      );
    } else if (typeof val === "object" && val !== null) {
      const subEntries = Object.entries(val);
      return (
        <Flex vertical gap={4}>
          {subEntries.map(([k, v], sIdx) => (
            <div key={sIdx} style={{ background: token.colorBgContainer, padding: "6px 10px", borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}` }}>
              <Text strong style={{ fontSize: 12, color: token.colorPrimary }}>
                👤 {k}:
              </Text>{" "}
              <Text style={{ fontSize: 12 }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</Text>
            </div>
          ))}
        </Flex>
      );
    } else {
      return <Text style={{ fontSize: 13, lineHeight: 1.6 }}>{String(val)}</Text>;
    }
  };

  // Formatted synopsis parser & renderer
  const renderFormattedSynopsis = (raw: string) => {
    if (!raw || !raw.trim()) {
      return (
        <Typography.Text type="secondary" style={{ fontStyle: "italic", fontSize: 12 }}>
          Chưa có nội dung Bối cảnh & Cốt truyện. Nhập thông tin phía trên và bấm "AI Tạo Bối cảnh" để sinh dữ liệu.
        </Typography.Text>
      );
    }

    // Try JSON parse
    try {
      const parsed = JSON.parse(raw.trim());
      if (typeof parsed === "object" && parsed !== null) {
        const keys = Object.keys(parsed);
        return (
          <Flex vertical gap="small">
            {keys.map((key, idx) => {
              const val = parsed[key];
              let displayLabel = key
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l) => l.toUpperCase());

              let icon = "📌";
              const lowerKey = key.toLowerCase();
              if (lowerKey.includes("ten_phim") || lowerKey.includes("title")) {
                icon = "🎬";
                displayLabel = "Tên Phim";
              } else if (lowerKey.includes("season") || lowerKey.includes("mua")) {
                icon = "📺";
                displayLabel = "Mùa / Season / Số tập";
              } else if (lowerKey.includes("nam") || lowerKey.includes("year")) {
                icon = "📅";
                displayLabel = "Năm Phát Hành";
              } else if (lowerKey.includes("cot_truyen") || lowerKey.includes("plot")) {
                icon = "📖";
                displayLabel = "Tóm Tắt Cốt Truyện Chính";
              } else if (lowerKey.includes("boi_canh") || lowerKey.includes("setting")) {
                icon = "🌍";
                displayLabel = "Bối Cảnh Thời Đại & Không Gian";
              } else if (lowerKey.includes("nhan_vat") || lowerKey.includes("character")) {
                icon = "👥";
                displayLabel = "Danh Sách Nhân Vật Chính";
              }

              return (
                <div key={idx} style={{ background: token.colorFillAlter, padding: "8px 12px", borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}` }}>
                  <Text strong style={{ fontSize: 12, color: token.colorPrimary, display: "block", marginBottom: 6 }}>
                    {icon} {displayLabel}
                  </Text>
                  {renderValueFormatted(val)}
                </div>
              );
            })}
          </Flex>
        );
      }
    } catch {
      // Plain text or markdown fallback
    }

    const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return (
      <Flex vertical gap={6}>
        {lines.map((line, idx) => {
          const cleanLine = line.replace(/^[*\-•\d.]+\s*/, "");
          const matchHeader = cleanLine.match(/^([^:]+):\s*(.+)$/);

          if (matchHeader) {
            const label = matchHeader[1].trim();
            const val = matchHeader[2].trim();
            let icon = "📌";
            const lowerLabel = label.toLowerCase();
            if (lowerLabel.includes("tên phim") || lowerLabel.includes("title")) icon = "🎬";
            else if (lowerLabel.includes("mùa") || lowerLabel.includes("season")) icon = "📺";
            else if (lowerLabel.includes("năm") || lowerLabel.includes("year")) icon = "📅";
            else if (lowerLabel.includes("cốt truyện") || lowerLabel.includes("plot")) icon = "📖";
            else if (lowerLabel.includes("bối cảnh") || lowerLabel.includes("setting")) icon = "🌍";
            else if (lowerLabel.includes("nhân vật") || lowerLabel.includes("character")) icon = "👥";

            return (
              <div key={idx} style={{ background: token.colorFillAlter, padding: "6px 10px", borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}` }}>
                <Text strong style={{ fontSize: 12, color: token.colorPrimary }}>
                  {icon} {label}:
                </Text>{" "}
                <Text style={{ fontSize: 12, lineHeight: 1.6 }}>{val}</Text>
              </div>
            );
          }

          return (
            <Typography.Paragraph key={idx} style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              {cleanLine}
            </Typography.Paragraph>
          );
        })}
      </Flex>
    );
  };

  // Formatted character graph parser & renderer with 2-WAY PAIR GROUPING & RELATIONSHIP TYPE
  const renderFormattedCharacterGraph = (raw: string) => {
    if (!raw || !raw.trim()) {
      return (
        <Typography.Text type="secondary" style={{ fontStyle: "italic", fontSize: 12 }}>
          Chưa có Bảng Quan hệ Nhân vật Chi tiết. Tải lên tệp phụ đề mẫu và bấm "Trích xuất Quan hệ Chi tiết" để tạo.
        </Typography.Text>
      );
    }

    let rulesList: Array<{ speaker: string; listener?: string; address: string; self: string; relationship?: string; note?: string }> = [];

    try {
      const parsed = JSON.parse(raw.trim());
      let itemsList: any[] = [];

      if (Array.isArray(parsed)) {
        itemsList = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        // Unwrap array or stringified array inside object keys (e.g. parsed.quy_tac_xung_ho_nhan_vat)
        const values = Object.values(parsed);
        for (const v of values) {
          if (Array.isArray(v)) {
            itemsList = v;
            break;
          } else if (typeof v === "string" && v.trim().startsWith("[")) {
            try {
              const innerParsed = JSON.parse(v.trim());
              if (Array.isArray(innerParsed)) {
                itemsList = innerParsed;
                break;
              }
            } catch {}
          }
        }

        // If no inner array found, fallback to key-value entries
        if (itemsList.length === 0) {
          rulesList = Object.entries(parsed).map(([key, val]) => ({
            speaker: key,
            address: typeof val === "object" ? JSON.stringify(val) : String(val),
            self: "",
          }));
        }
      }

      if (itemsList.length > 0) {
        const parseCallObjOrStr = (val: any) => {
          if (typeof val === "object" && val !== null) {
            return {
              address: val.tu_goi || val.call_term || val.address || val.call || "",
              self: val.tu_xung || val.self_term || val.self || val.pronoun || "",
              relationship: val.moi_quan_he || val.relationship || val.relation || "",
              note: val.sac_thai || val.ghi_chu || val.note || val.tone || "",
            };
          }
          if (typeof val === "string") {
            let cleanLine = val.trim();
            let relationship = "";

            const relMatch = cleanLine.match(/\[(?:Mối quan hệ|Quan hệ):\s*(.+?)\]|\((?:Mối quan hệ|Quan hệ):\s*(.+?)\)/i);
            if (relMatch) {
              relationship = (relMatch[1] || relMatch[2]).trim();
              cleanLine = cleanLine.replace(relMatch[0], "").trim();
            }

            const callMatch = cleanLine.match(/^(.+?)\s+gọi\s+(.+?)\s+là\s+["“]?(.+?)["”]?,\s*xưng\s+(?:là\s+)?["“]?(.+?)["”]?\s*(?:\((.+?)\))?$/i);
            if (callMatch) {
              return {
                speaker: callMatch[1].trim(),
                listener: callMatch[2].trim(),
                address: callMatch[3].trim(),
                self: callMatch[4].trim(),
                relationship,
                note: callMatch[5]?.trim() || "",
              };
            }

            return { address: cleanLine, relationship };
          }
          return {};
        };

        itemsList.forEach((item, idx) => {
          if (typeof item === "object" && item !== null) {
            const charA = item.character_a || item.nhan_vat_a || item.speaker || `Nhân vật ${idx + 1}`;
            const charB = item.character_b || item.nhan_vat_b || item.listener || item.target || "";

            const aToBVal = item.a_calls_b || item.chieu_a_goi_b || item.direction_a_to_b;
            const bToAVal = item.b_calls_a || item.chieu_b_goi_a || item.direction_b_to_a;

            if (aToBVal) {
              const parsedA = parseCallObjOrStr(aToBVal);
              rulesList.push({
                speaker: parsedA.speaker || charA,
                listener: parsedA.listener || charB,
                address: parsedA.address || item.a_goi_b || item.address || "",
                self: parsedA.self || item.a_xung_voi_b || item.self || "",
                relationship: parsedA.relationship || item.moi_quan_he || item.relationship || "",
                note: parsedA.note || item.sac_thai || item.note || "",
              });
            } else {
              rulesList.push({
                speaker: charA,
                listener: charB,
                address: item.a_goi_b || item.xung_ho_goi || item.address || item.call || item.pronoun || "",
                self: item.a_xung_voi_b || item.xung_ho_xung || item.self || item.self_pronoun || "",
                relationship: item.moi_quan_he || item.relationship || item.relation || "",
                note: item.sac_thai || item.ghi_chu || item.note || item.tone || "",
              });
            }

            if (bToAVal) {
              const parsedB = parseCallObjOrStr(bToAVal);
              rulesList.push({
                speaker: parsedB.speaker || charB,
                listener: parsedB.listener || charA,
                address: parsedB.address || item.b_goi_a || "",
                self: parsedB.self || item.b_xung_voi_a || "",
                relationship: parsedB.relationship || item.moi_quan_he || item.relationship || "",
                note: parsedB.note || item.sac_thai || item.note || "",
              });
            }
          } else {
            rulesList.push({ speaker: "Quy tắc", address: String(item), self: "" });
          }
        });
      }
    } catch {
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      rulesList = lines.map((line) => {
        let cleanLine = line.replace(/^[*\-•\d.]+\s*/, "");
        let relationship = "";

        // Extract [Mối quan hệ: ...] or (Quan hệ: ...)
        const relMatch = cleanLine.match(/\[(?:Mối quan hệ|Quan hệ):\s*(.+?)\]|\((?:Mối quan hệ|Quan hệ):\s*(.+?)\)/i);
        if (relMatch) {
          relationship = (relMatch[1] || relMatch[2]).trim();
          cleanLine = cleanLine.replace(relMatch[0], "").trim();
        }

        const callMatch = cleanLine.match(/^(.+?)\s+gọi\s+(.+?)\s+là\s+["“]?(.+?)["”]?,\s*xưng\s+(?:là\s+)?["“]?(.+?)["”]?\s*(?:\((.+?)\))?$/i);
        if (callMatch) {
          return {
            speaker: callMatch[1].trim(),
            listener: callMatch[2].trim(),
            address: callMatch[3].trim(),
            self: callMatch[4].trim(),
            relationship,
            note: callMatch[5]?.trim() || "",
          };
        }

        const arrowMatch = cleanLine.match(/^(.+?)\s*(?:->|→|:)\s*(.+)$/);
        if (arrowMatch) {
          return {
            speaker: arrowMatch[1].trim(),
            address: arrowMatch[2].trim(),
            self: "",
            relationship,
          };
        }

        return { speaker: "Quy tắc", address: cleanLine, self: "", relationship };
      });
    }

    // GROUP BY PAIR (Person A & Person B)
    interface PairGroup {
      personA: string;
      personB: string;
      relationship?: string;
      aToB?: { address: string; self: string; note?: string };
      bToA?: { address: string; self: string; note?: string };
      generalNote?: string;
    }

    const pairMap = new Map<string, PairGroup>();
    const ungrouped: Array<{ speaker: string; address: string; self: string; note?: string }> = [];

    rulesList.forEach((r) => {
      const spk = r.speaker.trim();
      const lis = (r.listener || "").trim();

      if (spk && lis && spk !== lis) {
        const key = [spk, lis].sort().join("::");
        let group = pairMap.get(key);
        if (!group) {
          group = { personA: spk, personB: lis };
          pairMap.set(key, group);
        }

        if (r.relationship && !group.relationship) {
          group.relationship = r.relationship;
        }

        if (spk === group.personA) {
          group.aToB = { address: r.address, self: r.self, note: r.note };
        } else {
          group.bToA = { address: r.address, self: r.self, note: r.note };
        }

        if (r.note && !group.generalNote) {
          group.generalNote = r.note;
        }
      } else {
        ungrouped.push(r);
      }
    });

    const pairs = Array.from(pairMap.values());

    const renderPronounValue = (val?: string) => {
      if (!val) return null;
      const parts = val.split("/").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        return (
          <Space size={4} wrap style={{ display: "inline-flex" }}>
            <Text strong style={{ color: token.colorText }}>"{parts[0]}"</Text>
            <Text type="secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
              (hoặc: {parts.slice(1).join(", ")})
            </Text>
          </Space>
        );
      }
      return <Text strong style={{ color: token.colorText }}>"{val}"</Text>;
    };

    return (
      <Flex vertical gap="small">
        {pairs.map((pair, idx) => (
          <Card
            key={idx}
            size="small"
            style={{
              background: token.colorFillAlter,
              borderColor: token.colorBorderSecondary,
              borderRadius: token.borderRadiusSM,
            }}
            styles={{ body: { padding: "8px 12px" } }}>
            <Flex vertical gap={6}>
              <Flex align="center" justify="space-between" wrap gap={4}>
                <Space size="small" wrap>
                  <Tag color="geekblue" style={{ fontSize: 13, fontWeight: 600, padding: "2px 8px", margin: 0 }}>
                    👥 {pair.personA} ↔ {pair.personB}
                  </Tag>
                  {pair.relationship && (
                    <Tag color="gold" style={{ fontWeight: 600, margin: 0 }}>
                      🤝 Quan hệ: {pair.relationship}
                    </Tag>
                  )}
                </Space>
                {pair.generalNote && (
                  <Text type="secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
                    ({pair.generalNote})
                  </Text>
                )}
              </Flex>

              <Row gutter={[8, 8]}>
                <Col xs={24} sm={12}>
                  <div style={{ background: token.colorBgContainer, padding: "6px 10px", borderRadius: 4, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Text strong style={{ fontSize: 12, color: token.colorPrimary }}>
                      {pair.personA} ➔ {pair.personB}:
                    </Text>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      {pair.aToB?.address && <div><strong>Gọi:</strong> {renderPronounValue(pair.aToB.address)}</div>}
                      {pair.aToB?.self && <div><strong>Xưng:</strong> {renderPronounValue(pair.aToB.self)}</div>}
                      {!pair.aToB?.address && !pair.aToB?.self && (
                        <Text type="secondary" style={{ fontStyle: "italic" }}>(Chưa rõ chiều này)</Text>
                      )}
                    </div>
                  </div>
                </Col>

                <Col xs={24} sm={12}>
                  <div style={{ background: token.colorBgContainer, padding: "6px 10px", borderRadius: 4, border: `1px solid ${token.colorBorderSecondary}` }}>
                    <Text strong style={{ fontSize: 12, color: "#722ed1" }}>
                      {pair.personB} ➔ {pair.personA}:
                    </Text>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      {pair.bToA?.address && <div><strong>Gọi:</strong> {renderPronounValue(pair.bToA.address)}</div>}
                      {pair.bToA?.self && <div><strong>Xưng:</strong> {renderPronounValue(pair.bToA.self)}</div>}
                      {!pair.bToA?.address && !pair.bToA?.self && (
                        <Text type="secondary" style={{ fontStyle: "italic" }}>(Chưa rõ chiều này)</Text>
                      )}
                    </div>
                  </div>
                </Col>
              </Row>
            </Flex>
          </Card>
        ))}

        {ungrouped.length > 0 && (
          <Flex vertical gap={4} style={{ marginTop: 4 }}>
            {ungrouped.map((item, idx) => (
              <Flex
                key={idx}
                justify="space-between"
                align="center"
                style={{
                  padding: "6px 10px",
                  background: token.colorFillAlter,
                  borderRadius: token.borderRadiusSM,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}>
                <Space size="small" wrap>
                  <Tag color="default" style={{ fontWeight: 600 }}>{item.speaker}</Tag>
                  {item.address && <Text style={{ fontSize: 12 }}>Gọi: <strong>"{item.address}"</strong></Text>}
                  {item.self && <Text style={{ fontSize: 12 }}>Xưng: <strong>"{item.self}"</strong></Text>}
                </Space>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    );
  };

  const isContextActive = !!(movieSynopsis?.trim() || characterGraphPromptBlock?.trim());

  return (
    <Card
      size="small"
      style={{
        marginBottom: token.marginMD,
        borderColor: isContextActive ? token.colorPrimaryBorder : token.colorBorderSecondary,
        background: isContextActive ? token.colorPrimaryBgHover + "10" : token.colorBgContainer,
      }}>
      <Collapse
        ghost
        size="small"
        defaultActiveKey={["1"]}
        items={[
          {
            key: "1",
            label: (
              <Flex align="center" justify="space-between" className="w-full" style={{ paddingRight: 8 }}>
                <Space>
                  <BookOutlined style={{ color: token.colorPrimary, fontSize: 16 }} />
                  <Typography.Text strong style={{ fontSize: 14 }}>
                    🎬 Bối cảnh, Cốt truyện & Quan hệ Nhân vật (Tùy chọn)
                  </Typography.Text>
                </Space>
                {isContextActive ? (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    Đã bật Bối cảnh Dịch
                  </Tag>
                ) : (
                  <Tag color="default">Chưa thiết lập</Tag>
                )}
              </Flex>
            ),
            children: (
              <Flex vertical gap="middle" style={{ paddingTop: 8 }}>
                {/* PART 1: Initial Context & Synopsis */}
                <div
                  style={{
                    background: token.colorFillAlter,
                    padding: token.paddingSM,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}>
                  <Flex vertical gap="small">
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      1️⃣ Tạo Bối cảnh ban đầu (Tổng hợp đồng thời từ Wikipedia, IMDb, TMDB & Mô tả)
                    </Typography.Text>

                    <Row gutter={[8, 8]}>
                      <Col xs={24} md={8}>
                        <Input
                          prefix={<GlobalOutlined style={{ color: "#1890ff" }} />}
                          placeholder="Link Wikipedia..."
                          value={wikiUrl}
                          onChange={(e) => setWikiUrl(e.target.value)}
                          allowClear
                          size="small"
                        />
                      </Col>
                      <Col xs={24} md={8}>
                        <Input
                          prefix={<VideoCameraOutlined style={{ color: "#faad14" }} />}
                          placeholder="Link IMDb (VD: tt0111161)..."
                          value={imdbUrl}
                          onChange={(e) => setImdbUrl(e.target.value)}
                          allowClear
                          size="small"
                        />
                      </Col>
                      <Col xs={24} md={8}>
                        <Input
                          prefix={<StarOutlined style={{ color: "#52c41a" }} />}
                          placeholder="Link TMDB / Mô tả phim..."
                          value={tmdbOrText}
                          onChange={(e) => setTmdbOrText(e.target.value)}
                          allowClear
                          size="small"
                        />
                      </Col>
                    </Row>

                    {detectedId && (
                      <Flex align="center" justify="space-between" style={{ padding: "4px 8px", background: token.colorInfoBg, borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorInfoBorder}` }} wrap gap={4}>
                        <Space size="small">
                          <Tag color="processing">ID: {detectedId}</Tag>
                          {hasCachedData ? (
                            <Text style={{ fontSize: 12, color: token.colorSuccess }}>
                              ⚡ Đã tìm thấy Bối cảnh trong Cache!
                            </Text>
                          ) : (
                            <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                              Chưa có Cache cho ID này
                            </Text>
                          )}
                        </Space>
                        <Space size="small" wrap>
                          {historyList.length > 0 && (
                            <Select
                              size="small"
                              placeholder={`🕒 Lịch sử phim (${historyList.length}/50)...`}
                              style={{ minWidth: 180 }}
                              onChange={handleSelectHistoryItem}
                              options={historyList.map((h) => ({
                                label: `🕒 ${h.movieId} (${new Date(h.timestamp).toLocaleDateString("vi-VN")})`,
                                value: h.movieId,
                              }))}
                            />
                          )}
                          {hasCachedData && (
                            <Button size="small" type="primary" ghost icon={<ReloadOutlined />} onClick={handleLoadFromCache}>
                              Nạp lại
                            </Button>
                          )}
                        </Space>
                      </Flex>
                    )}

                    {!detectedId && historyList.length > 0 && (
                      <Flex align="center" justify="space-between" style={{ padding: "4px 8px", background: token.colorFillAlter, borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}` }} wrap gap={4}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          🕒 Lịch sử Bối cảnh đã lưu ({historyList.length}/50 phim trong Cache)
                        </Text>
                        <Select
                          size="small"
                          placeholder="Chọn phim từ lịch sử..."
                          style={{ minWidth: 200 }}
                          onChange={handleSelectHistoryItem}
                          options={historyList.map((h) => ({
                            label: `🕒 ${h.movieId} (${new Date(h.timestamp).toLocaleDateString("vi-VN")})`,
                            value: h.movieId,
                          }))}
                        />
                      </Flex>
                    )}

                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      loading={generatingContext}
                      onClick={handleGenerateContext}
                      style={{ width: "100%", marginTop: 4 }}>
                      AI Tạo Bối cảnh Tổng hợp từ các Nguồn trên
                    </Button>

                    {/* Part 1 Content Tabs: Formatted Text vs JSON */}
                    <Tabs
                      size="small"
                      type="card"
                      activeKey={part1Tab}
                      onChange={setPart1Tab}
                      style={{ marginTop: 8 }}
                      items={[
                        {
                          key: "formatted",
                          label: (
                            <Space size={4}>
                              <EyeOutlined />
                              <span>📄 Văn bản đọc hiểu</span>
                            </Space>
                          ),
                          children: (
                            <div style={{ padding: "8px 12px", background: token.colorBgContainer, borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}`, maxHeight: 250, overflowY: "auto" }}>
                              {renderFormattedSynopsis(movieSynopsis || "")}
                            </div>
                          ),
                        },
                        {
                          key: "json",
                          label: (
                            <Space size={4}>
                              <CodeOutlined />
                              <span>💻 JSON / Mã thô (Gửi AI)</span>
                            </Space>
                          ),
                          children: (
                            <Input.TextArea
                              rows={5}
                              placeholder="Nội dung Bối cảnh & Cốt truyện dạng JSON / Raw text..."
                              value={movieSynopsis || ""}
                              onChange={(e) => setMovieSynopsis && setMovieSynopsis(e.target.value)}
                              style={{ fontSize: 12, fontFamily: "monospace" }}
                            />
                          ),
                        },
                      ]}
                    />
                  </Flex>
                </div>

                {/* PART 2: Detailed Character Relationship Builder */}
                <div
                  style={{
                    background: token.colorFillAlter,
                    padding: token.paddingSM,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}>
                  <Flex vertical gap="small">
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      2️⃣ Xây dựng Quan hệ Nhân vật Chi tiết (Từ Subtitle mẫu Tập 1, 2...)
                    </Typography.Text>

                    <Flex align="center" gap="small" wrap>
                      <Upload beforeUpload={handleSampleFileUpload} showUploadList={false} multiple>
                        <Button icon={<UploadOutlined size={12} />}>Chọn Subtitle mẫu</Button>
                      </Upload>
                    </Flex>

                    {sampleFiles.length > 0 && (
                      <Flex vertical gap={4} style={{ marginTop: 4 }}>
                        <Flex align="center" justify="space-between">
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            📁 Đã chọn {sampleFiles.length} file phụ đề mẫu
                          </Text>
                          {sampleFiles.length > 3 && (
                            <Button
                              type="link"
                              size="small"
                              onClick={() => setCollapseSamples(!collapseSamples)}
                              style={{ padding: 0, height: "auto", fontSize: 11 }}>
                              {collapseSamples ? `🔽 Hiện tất cả (${sampleFiles.length})` : "🔼 Thu gọn"}
                            </Button>
                          )}
                        </Flex>

                        <Flex gap={4} wrap>
                          {(collapseSamples ? sampleFiles.slice(0, 3) : sampleFiles).map((file, idx) => (
                            <Tag key={idx} closable onClose={() => handleRemoveSampleFile(idx)} icon={<FileTextOutlined />}>
                              {file.name}
                            </Tag>
                          ))}
                          {collapseSamples && sampleFiles.length > 3 && (
                            <Tag color="default">+{sampleFiles.length - 3} file khác...</Tag>
                          )}
                        </Flex>
                      </Flex>
                    )}

                    {/* Dedicated Full-Width Action Line for Extracting Graph */}
                    <Button
                      type="primary"
                      ghost
                      icon={<UsergroupAddOutlined />}
                      loading={extractingGraph}
                      disabled={sampleFiles.length === 0}
                      onClick={handleExtractCharacterGraph}
                      style={{ width: "100%", marginTop: 8 }}>
                      👥 AI Trích xuất Quan hệ Chi tiết từ {sampleFiles.length} Subtitle Mẫu
                    </Button>

                    {/* Part 2 Content Tabs: Formatted Graph vs JSON */}
                    <Tabs
                      size="small"
                      type="card"
                      activeKey={part2Tab}
                      onChange={setPart2Tab}
                      style={{ marginTop: 8 }}
                      items={[
                        {
                          key: "formatted",
                          label: (
                            <Space size={4}>
                              <EyeOutlined />
                              <span>📄 Bảng Quan hệ đọc hiểu</span>
                            </Space>
                          ),
                          children: (
                            <div style={{ padding: "8px 12px", background: token.colorBgContainer, borderRadius: token.borderRadiusSM, border: `1px solid ${token.colorBorderSecondary}`, maxHeight: 250, overflowY: "auto" }}>
                              {renderFormattedCharacterGraph(characterGraphPromptBlock || "")}
                            </div>
                          ),
                        },
                        {
                          key: "json",
                          label: (
                            <Space size={4}>
                              <CodeOutlined />
                              <span>💻 JSON / Mã thô (Gửi AI)</span>
                            </Space>
                          ),
                          children: (
                            <Input.TextArea
                              rows={5}
                              placeholder="Bảng Quy tắc Quan hệ & Xưng hô dạng JSON / Raw text..."
                              value={characterGraphPromptBlock || ""}
                              onChange={(e) => setCharacterGraphPromptBlock && setCharacterGraphPromptBlock(e.target.value)}
                              style={{ fontSize: 12, fontFamily: "monospace" }}
                            />
                          ),
                        },
                      ]}
                    />
                  </Flex>
                </div>

                {/* Clear / Reset actions */}
                {isContextActive && (
                  <Flex justify="end">
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        setMovieSynopsis && setMovieSynopsis("");
                        setCharacterGraphPromptBlock && setCharacterGraphPromptBlock("");
                        setWikiUrl("");
                        setImdbUrl("");
                        setTmdbOrText("");
                        message.info("Đã xóa Bối cảnh, Quan hệ nhân vật & các Link.");
                      }}>
                      Xóa & Reset Bối cảnh
                    </Button>
                  </Flex>
                )}
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );
};
