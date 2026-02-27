import { useState, useRef, useEffect, useCallback } from 'react';
import type React from 'react';

interface UseInlineEditOptions {
  onSave: (value: string) => void;
}

interface UseInlineEditReturn {
  isEditing: boolean;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  startEditing: (initialValue: string) => void;
  setEditValue: (value: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleBlur: () => void;
}

export function useInlineEdit({ onSave }: UseInlineEditOptions): UseInlineEditReturn {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const startEditing = useCallback((initialValue: string) => {
    setEditValue(initialValue);
    setIsEditing(true);
  }, []);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        const trimmed = editValue.trim();
        if (trimmed) {
          onSave(trimmed);
        }
        setIsEditing(false);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        setIsEditing(false);
      }
    },
    [editValue, onSave]
  );

  const handleBlur = useCallback(() => {
    setIsEditing(false);
  }, []);

  return {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleKeyDown,
    handleBlur,
  };
}
