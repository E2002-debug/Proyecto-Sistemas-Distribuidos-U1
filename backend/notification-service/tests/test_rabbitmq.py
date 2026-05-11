import json
import pytest

from sockets.rabbitmqConsumer import process_notification

def test_process_notification_en_camino(mocker):
    """Verifica que se guarda la notificación correcta para estado 'en camino'."""
    mock_save = mocker.patch('sockets.rabbitmqConsumer.save_notification', return_value=555)
    mock_push = mocker.patch('sockets.rabbitmqConsumer.push')

    body = json.dumps({
        'orderId': 'O-999',
        'status': 'en camino',
        'customerName': 'Maria Gomez',
        'address': 'Avenida 456'
    }).encode('utf-8')

    process_notification(body)

    mock_save.assert_called_once_with(
        'O-999',
        'Tu repartidor está en camino a tu dirección',
        'en_camino',
        'info'
    )
    # push debe haberse llamado 2 veces: canal por pedido y canal global
    assert mock_push.call_count == 2

def test_process_notification_entregado(mocker):
    """Verifica el mensaje correcto para estado 'entregado'."""
    mock_save = mocker.patch('sockets.rabbitmqConsumer.save_notification', return_value=556)
    mock_push = mocker.patch('sockets.rabbitmqConsumer.push')

    body = json.dumps({'orderId': 'O-888', 'status': 'entregado'}).encode('utf-8')

    process_notification(body)

    mock_save.assert_called_once_with(
        'O-888',
        '¡Tu pedido ha sido entregado exitosamente!',
        'entregado',
        'success'
    )
