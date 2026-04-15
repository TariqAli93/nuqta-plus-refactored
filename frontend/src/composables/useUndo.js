import { ref } from 'vue';
import { useNotificationStore } from '@/stores/notification';

/**
 * Composable for undo functionality
 */
export function useUndo() {
  const notificationStore = useNotificationStore();
  const undoStack = ref([]);
  const maxStackSize = 10;

  /**
   * Register an undoable action
   * @param {Object} action - Action object with undo function
   * @param {String} message - Message to show in notification
   */
  const registerUndo = (action, message = 'تم الحذف') => {
    // Add to stack
    undoStack.value.unshift({
      ...action,
      timestamp: Date.now(),
    });

    // Limit stack size
    if (undoStack.value.length > maxStackSize) {
      undoStack.value = undoStack.value.slice(0, maxStackSize);
    }

    // Show notification with undo button
    notificationStore.show({
      type: 'success',
      message: message,
      timeout: 5000,
      action: {
        label: 'تراجع',
        onClick: () => {
          undo();
        },
      },
    });
  };

  /**
   * Execute undo for the most recent action
   */
  const undo = () => {
    if (undoStack.value.length === 0) return;

    const action = undoStack.value.shift();
    if (action.undo) {
      action.undo();
      notificationStore.show({
        type: 'info',
        message: 'تم التراجع عن الإجراء',
        timeout: 3000,
      });
    }
  };

  /**
   * Clear undo stack
   */
  const clearStack = () => {
    undoStack.value = [];
  };

  return {
    registerUndo,
    undo,
    clearStack,
    hasUndo: () => undoStack.value.length > 0,
  };
}
