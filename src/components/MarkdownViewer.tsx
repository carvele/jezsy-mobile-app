import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];

  if (!content) return null;

  const lines = content.split('\n');

  const renderInline = (text: string) => {
    // Basic bold parsing: **text**
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <Text key={index} style={[styles.boldText, { color: colors.text }]}>
            {part.slice(2, -2)}
          </Text>
        );
      }
      return (
        <Text key={index} style={{ color: colors.text }}>
          {part}
        </Text>
      );
    });
  };

  return (
    <View style={styles.container}>
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <View key={index} style={styles.spacing} />;
        }

        // Horizontal Rule
        if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
          return (
            <View
              key={index}
              style={[styles.divider, { backgroundColor: colors.border }]}
            />
          );
        }

        // Heading 1
        if (trimmed.startsWith('# ')) {
          return (
            <Text
              key={index}
              style={[styles.h1, { color: colors.text }]}
            >
              {trimmed.replace('# ', '')}
            </Text>
          );
        }

        // Heading 2
        if (trimmed.startsWith('## ')) {
          return (
            <Text
              key={index}
              style={[styles.h2, { color: colors.text }]}
            >
              {trimmed.replace('## ', '')}
            </Text>
          );
        }

        // Heading 3
        if (trimmed.startsWith('### ')) {
          return (
            <Text
              key={index}
              style={[styles.h3, { color: colors.text }]}
            >
              {trimmed.replace('### ', '')}
            </Text>
          );
        }

        // Blockquote
        if (trimmed.startsWith('> ')) {
          return (
            <View
              key={index}
              style={[
                styles.blockquote,
                {
                  borderLeftColor: colors.tint,
                  backgroundColor: colorScheme === 'dark' ? '#222' : '#F7F7F7',
                },
              ]}
            >
              <Text style={[styles.blockquoteText, { color: colors.secondaryText }]}>
                {trimmed.replace('> ', '')}
              </Text>
            </View>
          );
        }

        // Bullet list item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const itemText = trimmed.slice(2);
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={[styles.bulletDot, { color: colors.tint }]}>•</Text>
              <Text style={[styles.bodyText, { color: colors.text, flex: 1 }]}>
                {renderInline(itemText)}
              </Text>
            </View>
          );
        }

        // Numbered list item: e.g. "1. "
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <View key={index} style={styles.bulletRow}>
              <Text style={[styles.numberPrefix, { color: colors.tint }]}>
                {numMatch[1]}.
              </Text>
              <Text style={[styles.bodyText, { color: colors.text, flex: 1 }]}>
                {renderInline(numMatch[2])}
              </Text>
            </View>
          );
        }

        // Default Paragraph
        return (
          <Text key={index} style={[styles.bodyText, { color: colors.text }]}>
            {renderInline(trimmed)}
          </Text>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  spacing: {
    height: 10,
  },
  divider: {
    height: 1,
    marginVertical: 14,
  },
  h1: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 6,
  },
  boldText: {
    fontWeight: '700',
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: 4,
  },
  blockquoteText: {
    fontSize: 13,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: 16,
    lineHeight: 22,
    marginRight: 8,
  },
  numberPrefix: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    marginRight: 8,
    minWidth: 18,
  },
});
