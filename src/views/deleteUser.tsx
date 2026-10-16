import React from 'react';
import { useLocation } from 'react-router-dom';
import { pizzaService } from '../service/service';
import View from './view';
import Button from '../components/button';
import { useBreadcrumb } from '../hooks/appNavigation';

export default function DeleteUser() {
  const state = useLocation().state;
  const navigateToParentPath = useBreadcrumb();
  const [message, setMessage] = React.useState('');

  async function deleteUser() {
    try {
      await pizzaService.deleteUser(state.user);
      navigateToParentPath();
    } catch (error) {
      setMessage(JSON.stringify(error));
    }
  }

  return (
    <View title='Sorry to see you go'>
      <div className='text-start py-8 px-4 sm:px-6 lg:px-8'>
        <div className='h-4 text-yellow-200 font-normal'>{message}</div>
        <div className='text-neutral-100'>
          Are you sure you want to delete <span className='text-orange-500'>{state.user.name}</span>? This will remove their account and cannot be restored.
        </div>
        <Button title='Delete' onPress={deleteUser} />
        <Button title='Cancel' onPress={navigateToParentPath} className='bg-transparent border-neutral-300' />
      </div>
    </View>
  );
}
