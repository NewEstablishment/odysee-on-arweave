import React from 'react';
import Button from 'component/button';
import { HOME_MEME_CLASS } from 'component/memeClasses';
type Props = {
  meme:
    | {
        text: string;
        url: string;
      }
    | null
    | undefined;
};
export default function Meme(props: Props) {
  const { meme } = props;

  if (!meme) {
    return null;
  }

  return (
    <h1 className={HOME_MEME_CLASS}>
      <Button button="link" navigate={meme.url}>
        {meme.text}
      </Button>
    </h1>
  );
}
