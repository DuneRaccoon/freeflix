import Link from 'next/link';
import Button from '@/components/ui/Button';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export default function MovieNotFound() {
  return (
    <div className="container mx-auto py-16 px-4">
      <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-lg text-center">
        <h1 className="text-2xl font-bold mb-4">Movie Not Found</h1>
        <p className="text-gray-300 mb-6">We couldn't find the movie you're looking for.</p>
        <Link href="/">
          <Button leftIcon={<ArrowLeftIcon className="w-5 h-5" />}>
            Back to Home
          </Button>
        </Link>
      </div>
    </div>
  );
}