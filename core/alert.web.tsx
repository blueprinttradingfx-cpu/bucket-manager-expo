// core/alert.web.tsx
// react-native-web ships Alert.alert() as a literal no-op (`static alert() {}`),
// so on web every Alert.alert(...) call in the app was silently doing nothing -
// no dialog, no console output, nothing to click. This file replaces it with a
// real dialog built from RN primitives (View/Text/Pressable/Modal all work
// fine on web via react-native-web), matching the same title/message/buttons
// signature so call sites don't need to change.
//
// <AlertHost /> must be mounted once near the root (see App.tsx) - it renders
// whatever alert is currently queued.

import React, { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { colors, spacing, radii, fonts } from './theme';

type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

interface AlertButton {
  text?: string;
  onPress?: (value?: string) => void;
  style?: AlertButtonStyle;
}

interface QueuedAlert {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

type Listener = (queue: QueuedAlert[]) => void;

let queue: QueuedAlert[] = [];
let listener: Listener | null = null;

function publish() {
  listener?.(queue);
}

class Alert {
  static alert(title: string, message?: string, buttons?: AlertButton[]) {
    queue = [...queue, { title, message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] }];
    publish();
  }
}

export default Alert;

export function AlertHost() {
  const [current, setCurrent] = useState<QueuedAlert[]>(queue);

  React.useEffect(() => {
    listener = setCurrent;
    return () => {
      listener = null;
    };
  }, []);

  const active = current[0] ?? null;

  function dismiss(btn: AlertButton) {
    queue = queue.slice(1);
    publish();
    // Let the modal's onRequestClose/press handler finish before running the
    // caller's callback, same ordering RN's native Alert gives you.
    btn.onPress?.();
  }

  if (!active) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => dismiss(active.buttons[0])}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{active.title}</Text>
          {active.message ? <Text style={styles.message}>{active.message}</Text> : null}
          <View style={styles.buttonRow}>
            {active.buttons.map((btn, i) => (
              <Pressable
                key={i}
                onPress={() => dismiss(btn)}
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    btn.style === 'destructive' && styles.destructiveText,
                    btn.style === 'cancel' && styles.cancelText,
                  ]}
                >
                  {btn.text ?? 'OK'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 15, 25, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.onSurface,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  button: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
  },
  buttonPressed: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  buttonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.primary,
  },
  destructiveText: {
    color: colors.error,
  },
  cancelText: {
    color: colors.onSurfaceVariant,
  },
});
