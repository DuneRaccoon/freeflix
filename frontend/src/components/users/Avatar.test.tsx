import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  it('renders the resolved image for a known id', () => {
    render(<Avatar value="house:reel" name="Ben Herro" size="md" />);
    const img = screen.getByRole('img', { name: 'Ben Herro' });
    expect(img).toHaveAttribute('src', '/avatars/house/reel.svg');
  });

  it('renders a monogram when there is no avatar', () => {
    render(<Avatar value={null} name="Ben Herro" size="md" />);
    expect(screen.getByText('BH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a monogram for an unresolvable value rather than an img', () => {
    render(<Avatar value="javascript:alert(1)" name="Ben Herro" size="md" />);
    expect(screen.getByText('BH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('falls back to the monogram when the image fails to load', () => {
    render(<Avatar value="house:reel" name="Ben Herro" size="md" />);
    fireEvent.error(screen.getByRole('img', { name: 'Ben Herro' }));
    expect(screen.getByText('BH')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('applies the squircle shape when asked', () => {
    const { container } = render(
      <Avatar value={null} name="Ben" size="xl" shape="squircle" />,
    );
    expect(container.firstChild).toHaveClass('rounded-[22px]');
  });

  it('recovers when the value changes after a load error', () => {
    const { rerender } = render(<Avatar value="house:reel" name="Ben Herro" size="md" />);
    fireEvent.error(screen.getByRole('img', { name: 'Ben Herro' }));
    expect(screen.getByText('BH')).toBeInTheDocument();

    rerender(<Avatar value="house:clapper" name="Ben Herro" size="md" />);
    expect(screen.getByRole('img', { name: 'Ben Herro' }))
      .toHaveAttribute('src', '/avatars/house/clapper.svg');
  });
});
