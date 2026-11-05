// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileDrop } from '../src/views/Library/componentes/FileDrop';

afterEach(cleanup);

describe('page file drop', () => {
  it('keeps the overlay across nested drag targets and clears it when leaving the page', () => {
    render(<FileDrop onFiles={vi.fn()} onReject={vi.fn()} />);
    const dataTransfer = { types: ['Files'] };
    fireEvent.dragEnter(window, { dataTransfer });
    fireEvent.dragEnter(document.body, { dataTransfer });
    fireEvent.dragLeave(document.body, { dataTransfer });
    expect(screen.getByText('Solte os vídeos para enviar')).toBeTruthy();
    fireEvent.dragLeave(window, { dataTransfer });
    expect(screen.queryByText('Solte os vídeos para enviar')).toBeNull();
  });

  it('accepts supported videos, rejects other files and prevents the browser opening the drop', () => {
    const onFiles = vi.fn();
    const onReject = vi.fn();
    render(<FileDrop onFiles={onFiles} onReject={onReject} />);
    const video = new File(['video'], 'movie.mp4', { type: 'video/mp4' });
    const unknownMime = new File(['video'], 'movie.mkv');
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const mismatched = new File(['text'], 'fake.mp4', { type: 'text/plain' });
    const dataTransfer = { types: ['Files'], files: [video, unknownMime, text, mismatched] };
    fireEvent.dragEnter(window, { dataTransfer });
    expect(fireEvent.drop(window, { dataTransfer })).toBe(false);
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([video, unknownMime]);
    expect(onReject).toHaveBeenCalledOnce();
    expect(screen.queryByText('Solte os vídeos para enviar')).toBeNull();
  });

  it('ignores text drags and never uploads an entirely invalid drop', () => {
    const onFiles = vi.fn();
    const onReject = vi.fn();
    render(<FileDrop onFiles={onFiles} onReject={onReject} />);
    expect(fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'] } })).toBe(true);
    expect(screen.queryByText('Solte os vídeos para enviar')).toBeNull();
    fireEvent.drop(window, {
      dataTransfer: { types: ['Files'], files: [new File(['text'], 'notes.txt')] },
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('clears the overlay on cancellation and removes listeners when unmounted', () => {
    const onFiles = vi.fn();
    const { unmount } = render(<FileDrop onFiles={onFiles} onReject={vi.fn()} />);
    const dataTransfer = { types: ['Files'], files: [new File(['video'], 'movie.mp4')] };
    fireEvent.dragEnter(window, { dataTransfer });
    fireEvent.dragEnd(window);
    expect(screen.queryByText('Solte os vídeos para enviar')).toBeNull();
    fireEvent.dragEnter(window, { dataTransfer });
    fireEvent.blur(window);
    expect(screen.queryByText('Solte os vídeos para enviar')).toBeNull();
    unmount();
    expect(fireEvent.drop(window, { dataTransfer })).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
